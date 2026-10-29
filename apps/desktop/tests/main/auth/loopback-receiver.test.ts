import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { LoopbackReceiver } from '../../../src/main/auth/loopback-receiver.js';

const nonce = 'abcdefghijklmnopqrstuvwxyzABCDEF';
const proof = 'completion-proof-value';

function send(url: string, method: string, body = '', contentType = 'application/json'): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const outgoing = request({ hostname: target.hostname, port: target.port, path: target.pathname, method, headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) } }, response => {
      response.resume(); response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers }));
    });
    outgoing.on('error', reject); outgoing.end(body);
  });
}

describe('LoopbackReceiver', () => {
  it('binds only the exact 127.0.0.1 path and accepts one valid POST', async () => {
    const handle = await new LoopbackReceiver(() => nonce).start();
    expect(handle.completionUri).toMatch(/^http:\/\/127\.0\.0\.1:(49\d{3}|[5-6]\d{4})\/taskpilot\/oauth\/complete\//);
    expect((await send(handle.completionUri.replace(nonce, `${nonce}x`), 'POST', JSON.stringify({ completionProof: proof }))).status).toBe(404);
    expect((await send(handle.completionUri, 'GET')).status).toBe(405);
    expect((await send(handle.completionUri, 'POST', JSON.stringify({ completionProof: 'short' }))).status).toBe(400);
    expect((await send(handle.completionUri, 'POST', JSON.stringify({ completionProof: proof, extra: true }))).status).toBe(400);
    expect((await send(handle.completionUri, 'POST', JSON.stringify({ completionProof: proof }))).status).toBe(204);
    await expect(handle.proof).resolves.toBe(proof);
    await expect(send(handle.completionUri, 'POST', JSON.stringify({ completionProof: proof }))).rejects.toBeDefined();
  });

  it('accepts the browser-compatible text/plain completion request', async () => {
    const handle = await new LoopbackReceiver(() => nonce).start();
    const response = await send(
      handle.completionUri,
      'POST',
      JSON.stringify({ completionProof: proof }),
      'text/plain;charset=UTF-8',
    );
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    await expect(handle.proof).resolves.toBe(proof);
  });

  it('rejects oversized bodies without consuming the receiver', async () => {
    const handle = await new LoopbackReceiver(() => nonce).start();
    expect((await send(handle.completionUri, 'POST', JSON.stringify({ completionProof: 'a'.repeat(5_000) }))).status).toBe(413);
    expect((await send(handle.completionUri, 'POST', JSON.stringify({ completionProof: proof }))).status).toBe(204);
    await expect(handle.proof).resolves.toBe(proof);
  });

  it('rebinds an exact safe port and nonce for crash recovery', async () => {
    const first = await new LoopbackReceiver(() => nonce).start();
    const port = Number(new URL(first.completionUri).port);
    await first.close();
    await first.proof.catch(() => undefined);
    const restored = await new LoopbackReceiver().start({ port, nonce });
    expect(restored.completionUri).toBe(`http://127.0.0.1:${port}/taskpilot/oauth/complete/${nonce}`);
    await restored.close();
    await restored.proof.catch(() => undefined);
  });
});
