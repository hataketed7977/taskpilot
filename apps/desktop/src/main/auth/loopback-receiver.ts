import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';

const MIN_PORT = 49_152;
const MAX_PORT = 65_535;
const MAX_BODY_BYTES = 4_096;
const PROOF = /^[A-Za-z0-9_-]{16,512}$/;

export interface LoopbackHandle {
  completionUri: string;
  nonce: string;
  proof: Promise<string>;
  close(): Promise<void>;
}

export class LoopbackReceiver {
  constructor(private readonly createNonce: () => string = () => randomBytes(32).toString('base64url')) {}

  async start(preferred?: { port: number; nonce: string }): Promise<LoopbackHandle> {
    const nonce = preferred?.nonce ?? this.createNonce();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) throw new Error('Invalid loopback nonce');
    const path = `/taskpilot/oauth/complete/${nonce}`;
    let resolveProof!: (proof: string) => void;
    let rejectProof!: (error: Error) => void;
    let settled = false;
    const proof = new Promise<string>((resolve, reject) => { resolveProof = resolve; rejectProof = reject; });
    const server = createServer((request, response) => {
      void handleRequest(request, response, path).then(completionProof => {
        if (completionProof === undefined || settled) return;
        settled = true;
        resolveProof(completionProof);
        void closeServer(server);
      }).catch(() => undefined);
    });
    server.on('error', error => {
      if (!settled) {
        settled = true;
        rejectProof(error);
      }
    });
    const port = await listen(server, preferred?.port);
    return {
      completionUri: `http://127.0.0.1:${port}${path}`,
      nonce,
      proof,
      close: async () => {
        if (!settled) {
          settled = true;
          rejectProof(new Error('Loopback receiver closed'));
        }
        await closeServer(server);
      },
    };
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  expectedPath: string,
): Promise<string | undefined> {
  if (request.url !== expectedPath) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
    request.resume();
    return undefined;
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' }).end();
    request.resume();
    return undefined;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  await new Promise<void>((resolve, reject) => {
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else if (!tooLarge) chunks.push(chunk);
    });
    request.once('end', resolve);
    request.once('aborted', () => reject(new Error('Loopback request aborted')));
    request.once('error', reject);
  }).catch(() => undefined);

  if (tooLarge) {
    response.writeHead(413, { 'Cache-Control': 'no-store' }).end();
    return undefined;
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!isCompletionBody(value)) throw new Error('Invalid loopback completion');
    response.writeHead(204, { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).end();
    return value.completionProof;
  } catch {
    response.writeHead(400, { 'Cache-Control': 'no-store' }).end();
    return undefined;
  }
}

function isCompletionBody(value: unknown): value is { completionProof: string } {
  return typeof value === 'object' && value !== null
    && Object.keys(value).length === 1
    && typeof (value as Record<string, unknown>).completionProof === 'string'
    && PROOF.test((value as { completionProof: string }).completionProof);
}

async function listen(server: Server, preferredPort?: number): Promise<number> {
  const attempts = preferredPort === undefined ? 32 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = preferredPort ?? randomInt(MIN_PORT, MAX_PORT + 1);
    if (port < MIN_PORT || port > MAX_PORT) throw new Error('Unsafe loopback port');
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
      return port;
    } catch (error) {
      if (preferredPort !== undefined || attempt === attempts - 1) throw error;
    }
  }
  throw new Error('Unable to bind loopback receiver');
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise(resolve => server.close(() => resolve()));
}
