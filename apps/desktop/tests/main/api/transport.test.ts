import { describe, expect, it, vi } from 'vitest';
import {
  GATEWAY_ORIGINS,
  FixedHttpTransport,
  OutcomeUnknownError,
  TransportError,
} from '../../../src/main/api/transport.js';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('FixedHttpTransport', () => {
  it('permits only an explicit local loopback origin override for system integration', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const transport = new FixedHttpTransport('local', fetcher, 'http://127.0.0.1:49152');

    await transport.request({ method: 'GET', path: '/v1/me' });
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:49152/v1/me', expect.any(Object));
    expect(() => new FixedHttpTransport('local', fetcher, 'https://attacker.invalid')).toThrow('Invalid Gateway origin override');
    expect(() => new FixedHttpTransport('production', fetcher, 'http://127.0.0.1:49152')).toThrow('Invalid Gateway origin override');
  });

  it('uses the standalone Gateway port rather than the Core API port by default', () => {
    expect(GATEWAY_ORIGINS.local).toBe('http://127.0.0.1:35432');
    expect(GATEWAY_ORIGINS.local).not.toBe('http://127.0.0.1:45432');
  });

  it('uses only the fixed environment origin and allowlisted endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const transport = new FixedHttpTransport('local', fetcher);

    await expect(transport.request({ method: 'GET', path: '/v1/me' })).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(`${GATEWAY_ORIGINS.local}/v1/me`, expect.any(Object));
    await expect(transport.request({ method: 'GET', path: 'https://attacker.invalid/token' })).rejects.toThrow('Endpoint is not allowlisted');
    await expect(transport.request({ method: 'GET', path: '/v1/workspaces/not-a-uuid/projects?limit=50' })).rejects.toThrow('Endpoint is not allowlisted');
  });

  it('permits only method-specific Workspace and Project routes with bounded list queries', async () => {
    const fetcher = vi.fn().mockImplementation(async () => jsonResponse({ items: [], nextCursor: null }));
    const transport = new FixedHttpTransport('local', fetcher);
    const workspace = '11111111-1111-4111-8111-111111111111';
    const project = '22222222-2222-4222-8222-222222222222';
    await expect(transport.request({ method: 'GET', path: '/v1/workspaces' })).resolves.toBeDefined();
    await expect(transport.request({ method: 'GET', path: `/v1/workspaces/${workspace}/projects?status=ACTIVE&limit=50` })).resolves.toBeDefined();
    await expect(transport.request({ method: 'PATCH', path: `/v1/projects/${project}`, body: {} })).resolves.toBeDefined();
    for (const input of [
      { method: 'POST' as const, path: '/v1/workspaces' },
      { method: 'GET' as const, path: `/v1/workspaces/${workspace}/projects?status=ACTIVE&limit=500` },
      { method: 'GET' as const, path: `/v1/workspaces/${workspace}/projects?status=ACTIVE&limit=50&url=https://evil.test` },
      { method: 'PATCH' as const, path: `/v1/projects/${project}:archive` },
    ]) await expect(transport.request(input)).rejects.toThrow('Endpoint is not allowlisted');
  });

  it('allowlists only POST for the fixed permanent Board deletion action', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const transport = new FixedHttpTransport('local', fetcher);
    const board = '33333333-3333-4333-8333-333333333333';
    const path = `/v1/boards/${board}:permanentlyDelete`;

    await expect(transport.request({ method: 'POST', path, body: {} })).resolves.toBeUndefined();
    await expect(transport.request({ method: 'DELETE', path })).rejects.toThrow('Endpoint is not allowlisted');
    await expect(transport.request({ method: 'POST', path: `${path}?retry=true` })).rejects.toThrow('Endpoint is not allowlisted');
  });

  it('rejects malformed Workspace, Project, and session-delivery endpoints', async () => {
    const transport = new FixedHttpTransport('local', vi.fn());
    for (const path of [
      '/v1/workspaces/not-a-uuid/projects?status=ACTIVE&limit=50',
      '/v1/workspaces/11111111-1111-4111-8111-111111111111/projects?limit=50',
      '/desktop/v1/auth/federated/deliveries/delivery-id/ack',
      '/desktop/v1/auth/federated/deliveries/delivery-id/abandon',
    ]) {
      await expect(transport.request({ method: 'POST', path })).rejects.toThrow('Endpoint is not allowlisted');
    }
  });

  it('sends only owned authorization and JSON fields for logout', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const transport = new FixedHttpTransport('production', fetcher);
    await transport.request({
      method: 'POST', path: '/v1/session:logout', accessToken: 'access-secret', body: {},
    });
    expect(fetcher).toHaveBeenCalledWith(
      `${GATEWAY_ORIGINS.production}/v1/session:logout`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access-secret' },
        body: JSON.stringify({}),
      }),
    );
  });

  it.each([
    [400, 'validation'],
    [401, 'authentication'],
    [403, 'authorization'],
    [409, 'conflict'],
    [503, 'temporary'],
    [418, 'unknown'],
  ] as const)('maps HTTP %s Problem Details to a stable %s error', async (status, category) => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      code: 'STABLE_CODE', path: 'displayName', retryAfterSeconds: 12, detail: 'must not cross the boundary',
    }, status));
    const transport = new FixedHttpTransport('local', fetcher);

    const error = await transport.request({ method: 'GET', path: '/v1/me' }).catch(value => value);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({
      status,
      detail: { code: 'STABLE_CODE', category, path: 'displayName', retryAfterSeconds: 12 },
    });
    expect(error).not.toHaveProperty('detail.detail');
  });

  it('uses a conservative fallback for malformed problem responses', async () => {
    const transport = new FixedHttpTransport('local', vi.fn().mockResolvedValue(jsonResponse('not-a-problem', 503)));
    await expect(transport.request({ method: 'GET', path: '/v1/me' })).rejects.toMatchObject({
      status: 503,
      detail: { code: 'UNEXPECTED_RESPONSE', category: 'temporary' },
    });
  });

  it('rejects oversized responses before returning their payload', async () => {
    const body = JSON.stringify({ value: 'x'.repeat(1024 * 1024) });
    const transport = new FixedHttpTransport('local', vi.fn().mockResolvedValue(new Response(body)));
    await expect(transport.request({ method: 'GET', path: '/v1/me' })).rejects.toThrow('Response is too large');
  });

  it('aborts at the configured timeout without guessing a normal POST result', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const transport = new FixedHttpTransport('local', fetcher);
    const request = transport.request({ method: 'POST', path: '/v1/federated-login-attempts', body: {}, timeoutMs: 5 });
    const expectation = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(5);
    await expectation;
    vi.useRealTimers();
  });

  it('reports unknown outcome only when the owning operation opts in', async () => {
    const networkFailure = new TypeError('offline');
    const transport = new FixedHttpTransport('local', vi.fn().mockRejectedValue(networkFailure));

    await expect(transport.request({
      method: 'POST', path: '/v1/federated-login-attempts', body: {},
    })).rejects.toBe(networkFailure);
    await expect(transport.request({
      method: 'POST', path: '/v1/federated-registrations', body: {}, outcomeUnknownOnNetworkFailure: true,
    })).rejects.toBeInstanceOf(OutcomeUnknownError);
  });


  it.each([
    [503, 'GATEWAY_UPSTREAM_UNAVAILABLE'],
    [504, 'GATEWAY_UPSTREAM_TIMEOUT'],
    [502, 'GATEWAY_RESPONSE_TOO_LARGE'],
  ] as const)('reports an unknown mutation outcome for Gateway transport HTTP %s (%s)', async (status, code) => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      type: 'https://taskpilot.ai/problems/gateway-transport', code,
    }, status));
    const transport = new FixedHttpTransport('local', fetcher);
    const boardId = '33333333-3333-4333-8333-333333333333';

    await expect(transport.request({
      method: 'POST',
      path: `/v1/boards/${boardId}:permanentlyDelete`,
      body: {},
      outcomeUnknownOnNetworkFailure: true,
    })).rejects.toBeInstanceOf(OutcomeUnknownError);
  });

  it('does not reinterpret Core business failures or non-opted-in requests as unknown outcomes', async () => {
    const boardId = '33333333-3333-4333-8333-333333333333';
    const gatewayFailure = new FixedHttpTransport('local', vi.fn().mockResolvedValue(
      jsonResponse({
        type: 'https://taskpilot.ai/problems/gateway-transport', code: 'GATEWAY_UPSTREAM_UNAVAILABLE',
      }, 503),
    ));
    const coreFailure = new FixedHttpTransport('local', vi.fn().mockResolvedValue(
      jsonResponse({ code: 'GATEWAY_UPSTREAM_UNAVAILABLE' }, 503),
    ));

    await expect(gatewayFailure.request({
      method: 'POST', path: `/v1/boards/${boardId}:permanentlyDelete`, body: {},
    })).rejects.toBeInstanceOf(TransportError);
    await expect(coreFailure.request({
      method: 'POST', path: `/v1/boards/${boardId}:permanentlyDelete`, body: {}, outcomeUnknownOnNetworkFailure: true,
    })).rejects.toMatchObject({ detail: { code: 'GATEWAY_UPSTREAM_UNAVAILABLE' } });
  });
});
