import { describe, expect, it, vi } from 'vitest';
import {
  CORE_API_ORIGINS,
  FixedHttpTransport,
  OutcomeUnknownError,
  TransportError,
} from '../../src/main/api/transport.js';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('FixedHttpTransport', () => {
  it('permits only an explicit local loopback origin override for system integration', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const transport = new FixedHttpTransport('local', fetcher, 'http://127.0.0.1:49152');

    await transport.request({ method: 'GET', path: '/desktop/v1/me' });
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:49152/desktop/v1/me', expect.any(Object));
    expect(() => new FixedHttpTransport('local', fetcher, 'https://attacker.invalid')).toThrow('Invalid Core API origin override');
    expect(() => new FixedHttpTransport('production', fetcher, 'http://127.0.0.1:49152')).toThrow('Invalid Core API origin override');
  });

  it('uses only the fixed environment origin and allowlisted endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const transport = new FixedHttpTransport('local', fetcher);

    await expect(transport.request({ method: 'GET', path: '/desktop/v1/me' })).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(`${CORE_API_ORIGINS.local}/desktop/v1/me`, expect.any(Object));
    await expect(transport.request({ method: 'GET', path: 'https://attacker.invalid/token' })).rejects.toThrow('Endpoint is not allowlisted');
    await expect(transport.request({ method: 'GET', path: '/desktop/v1/workspaces/not-a-uuid/projects?limit=50' })).rejects.toThrow('Endpoint is not allowlisted');
  });

  it('allows only the fixed Project path and query keys while preserving an encoded opaque cursor', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const transport = new FixedHttpTransport('local', fetcher);
    const path = '/desktop/v1/workspaces/11111111-1111-4111-8111-111111111111/projects?cursor=opaque%2Bvalue%2Fwith%3Dpadding&limit=50';

    await expect(transport.request({ method: 'GET', path })).resolves.toEqual({ items: [] });
    expect(fetcher).toHaveBeenCalledWith(`${CORE_API_ORIGINS.local}${path}`, expect.any(Object));
    await expect(transport.request({ method: 'GET', path: `${path}&role=ADMIN` })).rejects.toThrow('Endpoint is not allowlisted');
    await expect(transport.request({ method: 'GET', path: '/desktop/v1/workspaces/11111111-1111-4111-8111-111111111111/projects?cursor=a&cursor=b&limit=50' })).rejects.toThrow('Endpoint is not allowlisted');
  });

  it('sends only owned authorization, idempotency and JSON request fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ workspaceId: '11111111-1111-4111-8111-111111111111' }, 201));
    const transport = new FixedHttpTransport('production', fetcher);

    await transport.request({
      method: 'POST',
      path: '/desktop/v1/workspaces',
      body: { name: 'North Star' },
      accessToken: 'access-secret',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      outcomeUnknownOnNetworkFailure: true,
    });

    expect(fetcher).toHaveBeenCalledWith(`${CORE_API_ORIGINS.production}/desktop/v1/workspaces`, expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer access-secret',
        'Idempotency-Key': '22222222-2222-4222-8222-222222222222',
      },
      body: JSON.stringify({ name: 'North Star' }),
    }));
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
      code: 'STABLE_CODE', path: 'email', retryAfterSeconds: 12, detail: 'must not cross the boundary',
    }, status));
    const transport = new FixedHttpTransport('local', fetcher);

    const error = await transport.request({ method: 'GET', path: '/desktop/v1/me' }).catch(value => value);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({
      status,
      detail: { code: 'STABLE_CODE', category, path: 'email', retryAfterSeconds: 12 },
    });
    expect(error).not.toHaveProperty('detail.detail');
  });

  it('uses a conservative fallback for malformed problem responses', async () => {
    const transport = new FixedHttpTransport('local', vi.fn().mockResolvedValue(jsonResponse('not-a-problem', 503)));
    await expect(transport.request({ method: 'GET', path: '/desktop/v1/me' })).rejects.toMatchObject({
      status: 503,
      detail: { code: 'UNEXPECTED_RESPONSE', category: 'temporary' },
    });
  });

  it('rejects oversized responses before returning their payload', async () => {
    const body = JSON.stringify({ value: 'x'.repeat(1024 * 1024) });
    const transport = new FixedHttpTransport('local', vi.fn().mockResolvedValue(new Response(body)));
    await expect(transport.request({ method: 'GET', path: '/desktop/v1/me' })).rejects.toThrow('Response is too large');
  });

  it('aborts at the configured timeout without guessing a normal POST result', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const transport = new FixedHttpTransport('local', fetcher);
    const request = transport.request({ method: 'POST', path: '/desktop/v1/auth/login/password', body: {}, timeoutMs: 5 });
    const expectation = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(5);
    await expectation;
    vi.useRealTimers();
  });

  it('reports unknown outcome only when the owning operation opts in', async () => {
    const networkFailure = new TypeError('offline');
    const transport = new FixedHttpTransport('local', vi.fn().mockRejectedValue(networkFailure));

    await expect(transport.request({
      method: 'POST', path: '/desktop/v1/auth/login/password', body: {},
    })).rejects.toBe(networkFailure);
    await expect(transport.request({
      method: 'POST', path: '/desktop/v1/auth/registration', body: {}, outcomeUnknownOnNetworkFailure: true,
    })).rejects.toBeInstanceOf(OutcomeUnknownError);
  });
});
