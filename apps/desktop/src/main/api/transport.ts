import type { DesktopError } from '../../shared/contracts.js';

export const CORE_API_ORIGINS = {
  local: 'http://127.0.0.1:8080',
  production: 'https://api.taskpilot.ai',
} as const;
export type Environment = keyof typeof CORE_API_ORIGINS;

const EXACT_PATHS = new Set([
  '/desktop/v1/auth/capabilities', '/desktop/v1/auth/federated/attempts',
  '/desktop/v1/auth/federated/registrations', '/desktop/v1/auth/session/refresh',
  '/desktop/v1/auth/session/logout', '/desktop/v1/me',
]);
const FEDERATED_ATTEMPT_PATH = /^\/desktop\/v1\/auth\/federated\/attempts\/[0-9a-f-]{36}\/(?:poll|cancel)$/i;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface TransportRequest { method: 'GET' | 'POST'; path: string; body?: unknown; accessToken?: string; idempotencyKey?: string; timeoutMs?: number; outcomeUnknownOnNetworkFailure?: boolean }
export interface HttpTransport { request<T>(request: TransportRequest): Promise<T> }
export class TransportError extends Error { constructor(public readonly detail: DesktopError, public readonly status?: number) { super(detail.code); } }
export class OutcomeUnknownError extends Error { constructor() { super('Request outcome is unknown'); } }

export class FixedHttpTransport implements HttpTransport {
  private readonly origin: string;
  constructor(
    private readonly environment: Environment,
    private readonly fetcher: typeof fetch = fetch,
    originOverride?: string,
  ) {
    this.origin = resolveOrigin(environment, originOverride);
  }
  async request<T>(request: TransportRequest): Promise<T> {
    if (!isAllowlistedPath(request.path)) throw new Error('Endpoint is not allowlisted');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 15_000);
    try {
      const response = await this.fetcher(`${this.origin}${request.path}`, {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          ...(request.accessToken ? { Authorization: `Bearer ${request.accessToken}` } : {}),
          ...(request.idempotencyKey ? { 'Idempotency-Key': request.idempotencyKey } : {}),
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('Response is too large');
      const payload = text ? JSON.parse(text) as unknown : undefined;
      if (!response.ok) throw mapProblem(response.status, payload);
      return payload as T;
    } catch (error) {
      if (request.outcomeUnknownOnNetworkFailure && isNetworkFailure(error)) throw new OutcomeUnknownError();
      throw error;
    } finally { clearTimeout(timeout); }
  }
}
function resolveOrigin(environment: Environment, originOverride?: string): string {
  if (originOverride === undefined) return CORE_API_ORIGINS[environment];
  if (environment !== 'local') throw new Error('Invalid Core API origin override');
  let parsed: URL;
  try { parsed = new URL(originOverride); } catch { throw new Error('Invalid Core API origin override'); }
  const port = Number(parsed.port);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65_535
    || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== originOverride) {
    throw new Error('Invalid Core API origin override');
  }
  return parsed.origin;
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError');
}
function mapProblem(status: number, payload: unknown): TransportError {
  const value = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
  const category: DesktopError['category'] = status === 400 ? 'validation' : status === 401 ? 'authentication' : status === 403 ? 'authorization' : status === 409 ? 'conflict' : status >= 500 ? 'temporary' : 'unknown';
  return new TransportError({ code: typeof value.code === 'string' ? value.code : 'UNEXPECTED_RESPONSE', category, path: typeof value.path === 'string' ? value.path : undefined, retryAfterSeconds: typeof value.retryAfterSeconds === 'number' ? value.retryAfterSeconds : undefined }, status);
}


function isAllowlistedPath(path: string): boolean {
  return EXACT_PATHS.has(path) || FEDERATED_ATTEMPT_PATH.test(path);
}
