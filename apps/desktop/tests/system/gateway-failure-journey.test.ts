/** @vitest-environment node */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { IssuedSession } from '../../src/shared/contracts.js';

const compiledModule = (path: string) => pathToFileURL(resolve('dist', path)).href;
const { FixedHttpTransport } = await import(compiledModule('main/api/transport.js')) as typeof import('../../src/main/api/transport.js');
const { MemoryCredentialStore } = await import(compiledModule('main/credentials/credential-store.js')) as typeof import('../../src/main/credentials/credential-store.js');
const { SessionCoordinator } = await import(compiledModule('main/session/session-coordinator.js')) as typeof import('../../src/main/session/session-coordinator.js');

const baseUrl = process.env.TASKPILOT_SYSTEM_BASE_URL;
const scenario = process.env.TASKPILOT_SYSTEM_FAILURE_SCENARIO;
const credential = {
  userId: '11111111-1111-4111-8111-111111111111',
  refreshToken: 'still-potentially-valid-refresh-token',
  refreshTokenExpiresAt: '2030-01-01T00:00:00Z',
};

describe('Desktop Gateway failure system journey', () => {
  it('fails temporarily without a Core fallback or credential loss', async () => {
    if (!baseUrl) throw new Error('TASKPILOT_SYSTEM_BASE_URL is required');
    if (scenario !== 'gateway-stopped' && scenario !== 'core-unavailable') {
      throw new Error('TASKPILOT_SYSTEM_FAILURE_SCENARIO is invalid');
    }
    expect(process.env.TASKPILOT_CORE_API_URL).toBeUndefined();
    expect(process.env.TASKPILOT_CORE_API_INTERNAL_URL).toBeUndefined();
    expect(process.env.TASKPILOT_CORE_API_PORT).toBeUndefined();

    const credentials = new MemoryCredentialStore();
    await credentials.saveCurrent('local', credential);
    const transport = new FixedHttpTransport('local', fetch, baseUrl);
    const session = new SessionCoordinator('local', credentials, {
      refresh: refreshToken => transport.request<IssuedSession>({
        method: 'POST',
        path: '/v1/session:refresh',
        body: { refreshToken },
      }),
      logout: (refreshToken, accessToken) => transport.request<void>({
        method: 'POST',
        path: '/v1/session:logout',
        ...(refreshToken ? { body: { refreshToken } } : { accessToken }),
      }),
    });

    const failure = await session.restore().then(
      () => undefined,
      error => error as { detail?: { category?: string; code?: string }; status?: number },
    );
    expect(failure).toBeDefined();
    if (scenario === 'gateway-stopped') {
      expect(failure).toBeInstanceOf(TypeError);
    } else {
      expect(failure).toMatchObject({
        detail: {
          category: 'temporary',
          code: 'GATEWAY_UPSTREAM_UNAVAILABLE',
        },
        status: 503,
      });
    }
    expect(session.view()).toEqual({ status: 'temporarilyUnavailable' });
    expect(await credentials.loadCurrent('local')).toEqual(credential);
  });
});
