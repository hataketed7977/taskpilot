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
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_COLLECTION_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects$`, 'i');
const PROJECT_ITEM_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects/(${UUID})$`, 'i');
const PROJECT_ACTION_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects/(${UUID})/(archive|restore|permanent-deletion)$`, 'i');
const BOARD_COLLECTION_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects/(${UUID})/boards$`, 'i');
const BOARD_ITEM_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects/(${UUID})/boards/(${UUID})$`, 'i');
const BOARD_COLUMN_COLLECTION_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects/(${UUID})/boards/(${UUID})/columns$`, 'i');
const BOARD_COLUMN_ITEM_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects/(${UUID})/boards/(${UUID})/columns/(${UUID})$`, 'i');
const BOARD_COLUMN_ORDER_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects/(${UUID})/boards/(${UUID})/column-order$`, 'i');
const BOARD_WORK_ITEM_COLLECTION_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects/(${UUID})/boards/(${UUID})/work-items$`, 'i');
const WORK_ITEM_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects/(${UUID})/work-items/(${UUID})$`, 'i');
const PLACEMENT_MOVE_PATH = new RegExp(`^/desktop/v1/workspaces/(${UUID})/projects/(${UUID})/boards/(${UUID})/placements/(${UUID})/move$`, 'i');
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface TransportRequest { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown; accessToken?: string; idempotencyKey?: string; timeoutMs?: number; outcomeUnknownOnNetworkFailure?: boolean }
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
    if (!isAllowlistedRequest(request)) throw new Error('Endpoint is not allowlisted');
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


function isAllowlistedRequest(request: TransportRequest): boolean {
  if (request.path.includes('#') || request.path.length > 4096) return false;
  const [pathname, query = ''] = request.path.split('?', 2);
  if (EXACT_PATHS.has(pathname!)) return query === '' && allowedExactMethod(pathname!, request.method);
  if (FEDERATED_ATTEMPT_PATH.test(pathname!)) return query === '' && request.method === 'POST';
  if (pathname === '/desktop/v1/workspaces') return query === '' && request.method === 'GET';
  if (PROJECT_COLLECTION_PATH.test(pathname!)) {
    return request.method === 'GET' ? validProjectQuery(query) : request.method === 'POST' && query === '';
  }
  if (PROJECT_ITEM_PATH.test(pathname!)) return query === '' && (request.method === 'GET' || request.method === 'PATCH');
  if (PROJECT_ACTION_PATH.test(pathname!)) return query === '' && request.method === 'POST';
  if (BOARD_COLLECTION_PATH.test(pathname!)) return query === '' && (request.method === 'GET' || request.method === 'POST');
  if (BOARD_ITEM_PATH.test(pathname!)) return query === '' && (request.method === 'GET' || request.method === 'PATCH');
  if (BOARD_COLUMN_COLLECTION_PATH.test(pathname!)) return query === '' && request.method === 'POST';
  if (BOARD_COLUMN_ITEM_PATH.test(pathname!)) {
    if (request.method === 'PATCH') return query === '';
    return request.method === 'DELETE' && validColumnDeleteQuery(query);
  }
  if (BOARD_COLUMN_ORDER_PATH.test(pathname!)) return query === '' && request.method === 'PUT';
  if (BOARD_WORK_ITEM_COLLECTION_PATH.test(pathname!)) return query === '' && request.method === 'POST';
  if (WORK_ITEM_PATH.test(pathname!)) return query === '' && (request.method === 'GET' || request.method === 'PATCH');
  if (PLACEMENT_MOVE_PATH.test(pathname!)) return query === '' && request.method === 'POST';
  return false;
}

function allowedExactMethod(path: string, method: TransportRequest['method']): boolean {
  return path === '/desktop/v1/auth/capabilities' || path === '/desktop/v1/me' ? method === 'GET' : method === 'POST';
}

function validProjectQuery(query: string): boolean {
  if (!query) return false;
  const search = new URLSearchParams(query);
  const keys = [...search.keys()];
  if (keys.some(key => !['status', 'limit', 'cursor'].includes(key)) || new Set(keys).size !== keys.length) return false;
  const status = search.get('status');
  const limit = Number(search.get('limit'));
  const cursor = search.get('cursor');
  return (status === 'ACTIVE' || status === 'ARCHIVED')
    && /^\d+$/.test(search.get('limit') ?? '') && Number.isInteger(limit) && limit >= 1 && limit <= 100
    && (cursor === null || (cursor.length >= 1 && cursor.length <= 2048));
}

function validColumnDeleteQuery(query: string): boolean {
  const search = new URLSearchParams(query);
  const keys = [...search.keys()];
  if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes('expectedBoardVersion') || !keys.includes('expectedColumnVersion')) return false;
  return ['expectedBoardVersion', 'expectedColumnVersion'].every(key => /^\d+$/.test(search.get(key) ?? ''));
}
