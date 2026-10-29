import { describe, expect, it, vi } from 'vitest';
import { FederatedAuthClient } from '../../../src/main/auth/auth-client.js';
import type { HttpTransport } from '../../../src/main/api/transport.js';

const session = {
  accessToken: 'access-secret', accessTokenExpiresAt: '2030-01-01T00:00:00Z',
  refreshToken: 'refresh-secret', refreshTokenExpiresAt: '2030-02-01T00:00:00Z',
  currentUser: { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' },
};

describe('FederatedAuthClient', () => {
  it('uses only the fixed GitHub federated endpoints and current request contracts', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ github: { enabled: true } })
      .mockResolvedValueOnce({
        attemptId: 'attempt', pollSecret: 'poll-secret-value',
        authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=id',
        expiresAt: '2030-01-01T00:00:00Z',
      })
      .mockResolvedValueOnce({ status: 'WAITING' })
      .mockResolvedValueOnce({ status: 'AUTHENTICATED', session })
      .mockResolvedValueOnce(undefined);
    const client = new FederatedAuthClient({ request } as HttpTransport);

    await client.capabilities();
    await client.createAttempt({
      installationId: 'installation',
      completionUri: 'http://127.0.0.1:50000/taskpilot/oauth/complete/abcdefghijklmnopqrstuvwxyzABCDEF',
    });
    await client.poll('attempt', { pollSecret: 'poll-secret-value', completionProof: 'completion-proof' });
    await client.register({
      continuationId: 'continuation-id', continuationSecret: 'continuation-secret-value',
      displayName: 'Ada', useSuggestedAvatar: true, legalBundleVersion: '2026-01',
      termsVersion: 'terms-v1', privacyVersion: 'privacy-v1', locale: 'zh-CN',
    });
    await client.cancel('attempt', 'poll-secret-value');

    expect(request.mock.calls.map(([input]) => `${input.method} ${input.path}`)).toEqual([
      'GET /desktop/v1/auth/capabilities',
      'POST /desktop/v1/auth/federated/attempts',
      'POST /desktop/v1/auth/federated/attempts/attempt/poll',
      'POST /desktop/v1/auth/federated/registrations',
      'POST /desktop/v1/auth/federated/attempts/attempt/cancel',
    ]);
    expect(request.mock.calls[1]?.[0]).toMatchObject({ body: { provider: 'github' } });
    expect(request.mock.calls[2]?.[0].body).toEqual({
      pollSecret: 'poll-secret-value', completionProof: 'completion-proof',
    });
    expect(request.mock.calls[3]?.[0]).not.toHaveProperty('outcomeUnknownOnNetworkFailure');
  });

  it('never places authentication secrets in a URL', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const client = new FederatedAuthClient({ request } as HttpTransport);
    await client.poll('attempt-id', {
      pollSecret: 'poll-secret-value', completionProof: 'proof-value-long-enough',
    });
    await client.register({
      continuationId: 'continuation-id', continuationSecret: 'continuation-secret-value',
      displayName: 'Ada', useSuggestedAvatar: false, legalBundleVersion: 'v1',
      termsVersion: 'terms-v1', privacyVersion: 'privacy-v1', locale: 'zh-CN',
    });

    for (const [input] of request.mock.calls) {
      expect(input.path).not.toMatch(/poll-secret|proof-value|continuation-secret/);
    }
  });
});
