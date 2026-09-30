import { describe, expect, it, vi } from 'vitest';
import { AuthClient, FlowCoordinator, OutcomeUnknownError } from '../../src/main/auth/auth-client.js';
import type { HttpTransport } from '../../src/main/api/transport.js';

const session = {
  accessToken: 'access-secret', accessTokenExpiresAt: '2030-01-01T00:00:00Z',
  refreshToken: 'refresh-secret', refreshTokenExpiresAt: '2030-02-01T00:00:00Z',
  currentUser: { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada', email: 'ada@example.com' },
};
const continuation = { continuationId: 'cid', continuationSecret: 'secret', expiresAt: '2030-01-01T00:00:00Z' };
const codeInput = { challengeId: '11111111-1111-4111-8111-111111111111', email: 'ada@example.com', code: '123456', deviceInstallationId: 'device' };

describe('AuthClient and Main-owned flow state', () => {
  it('uses fixed request endpoints and keeps continuation secret behind an opaque handle', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ challengeId: 'c1', retryAfterSeconds: 30 })
      .mockResolvedValueOnce({ challengeId: 'c2', retryAfterSeconds: 30 })
      .mockResolvedValueOnce({ challengeId: 'c3', retryAfterSeconds: 30 })
      .mockResolvedValueOnce(continuation)
      .mockResolvedValueOnce(continuation);
    const flows = new FlowCoordinator(() => `flow-${request.mock.calls.length}`);
    const client = new AuthClient({ request } as HttpTransport, flows);

    await client.requestRegistrationCode({ email: 'ada@example.com', deviceInstallationId: 'device' });
    await client.requestLoginCode({ email: 'ada@example.com', deviceInstallationId: 'device' });
    await client.requestPasswordResetCode({ email: 'ada@example.com', deviceInstallationId: 'device' });
    const registration = await client.verifyRegistrationCode(codeInput);
    const reset = await client.verifyPasswordResetCode(codeInput);

    expect(request.mock.calls.map(([value]) => value.path)).toEqual([
      '/desktop/v1/auth/registration/code', '/desktop/v1/auth/login/code', '/desktop/v1/auth/password-reset/code',
      '/desktop/v1/auth/registration/code/verify', '/desktop/v1/auth/password-reset/code/verify',
    ]);
    expect(JSON.stringify([registration, reset])).not.toContain('secret');
  });

  it('isolates purpose, email and one-time flow consumption', async () => {
    const request = vi.fn().mockResolvedValue(session);
    const flows = new FlowCoordinator(() => 'unused');
    const client = new AuthClient({ request } as HttpTransport, flows);
    flows.store('registration', { ...continuation, email: 'ada@example.com', kind: 'registration' });
    flows.store('reset', { ...continuation, email: 'ada@example.com', kind: 'passwordReset' });

    await expect(client.resetPassword({ flowHandle: 'registration', email: 'ada@example.com', newPassword: 'new password' })).rejects.toThrow('PASSWORD_RESET_CONTEXT_EXPIRED');
    await expect(client.register({ flowHandle: 'reset', email: 'ada@example.com', displayName: 'Ada', password: 'new password', termsVersion: 'v1' })).rejects.toThrow('REGISTRATION_CONTEXT_EXPIRED');
    flows.store('email-mismatch', { ...continuation, email: 'ada@example.com', kind: 'registration' });
    await expect(client.register({ flowHandle: 'email-mismatch', email: 'eve@example.com', displayName: 'Eve', password: 'new password', termsVersion: 'v1' })).rejects.toThrow('REGISTRATION_CONTEXT_EXPIRED');
    expect(request).not.toHaveBeenCalled();
  });

  it('submits registration once, clears its secret and opts into conservative unknown-outcome handling', async () => {
    const request = vi.fn().mockResolvedValue(session);
    const flows = new FlowCoordinator(() => 'flow');
    flows.store('flow', { ...continuation, email: 'ada@example.com', kind: 'registration' });
    const client = new AuthClient({ request } as HttpTransport, flows);

    await expect(client.register({ flowHandle: 'flow', email: 'ada@example.com', displayName: 'Ada', password: 'long password', termsVersion: 'v1' })).resolves.toEqual(session);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST', path: '/desktop/v1/auth/registration', outcomeUnknownOnNetworkFailure: true,
      body: expect.objectContaining({ continuationSecret: 'secret' }),
    }));
    await expect(client.register({ flowHandle: 'flow', email: 'ada@example.com', displayName: 'Ada', password: 'long password', termsVersion: 'v1' })).rejects.toThrow('REGISTRATION_CONTEXT_EXPIRED');
  });

  it('clears registration secret and returns conservative login recovery when outcome is unknown', async () => {
    const transport = { request: vi.fn().mockRejectedValue(new OutcomeUnknownError()) } as unknown as HttpTransport;
    const flows = new FlowCoordinator(() => 'flow');
    flows.store('flow', { ...continuation, email: 'ada@example.com', kind: 'registration' });
    const client = new AuthClient(transport, flows);
    await expect(client.register({ flowHandle: 'flow', email: 'ada@example.com', displayName: 'Ada', password: 'long password', termsVersion: 'v1' })).rejects.toMatchObject({ code: 'REGISTRATION_RESULT_UNKNOWN', recovery: 'SIGN_IN' });
    expect(flows.take('flow', 'registration')).toBeUndefined();
  });

  it('resets password with a one-time reset flow and does not opt into blind retry semantics', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const flows = new FlowCoordinator();
    flows.store('reset', { ...continuation, email: 'ada@example.com', kind: 'passwordReset' });
    const client = new AuthClient({ request } as HttpTransport, flows);

    await client.resetPassword({ flowHandle: 'reset', email: 'ada@example.com', newPassword: 'new password' });
    expect(request).toHaveBeenCalledWith({
      method: 'POST', path: '/desktop/v1/auth/password-reset', outcomeUnknownOnNetworkFailure: false,
      body: { continuationId: 'cid', continuationSecret: 'secret', email: 'ada@example.com', newPassword: 'new password' },
    });
    await expect(client.resetPassword({ flowHandle: 'reset', email: 'ada@example.com', newPassword: 'other' })).rejects.toThrow('PASSWORD_RESET_CONTEXT_EXPIRED');
  });

  it('clears every in-memory continuation on lifecycle teardown', () => {
    const flows = new FlowCoordinator();
    flows.store('flow', { ...continuation, email: 'ada@example.com', kind: 'registration' });
    expect(flows.peek('flow', 'registration')).toBeDefined();
    flows.clear();
    expect(flows.peek('flow', 'registration')).toBeUndefined();
  });

  it('never places password, OTP or token in URL', async () => {
    const request = vi.fn().mockResolvedValue(session);
    const client = new AuthClient({ request } as HttpTransport, new FlowCoordinator());
    await client.signInWithPassword({ email: 'ada@example.com', password: 'p@ss word' });
    await client.verifyLoginCode(codeInput);
    for (const [call] of request.mock.calls) {
      expect(call.path).not.toMatch(/p%40ss|access-secret|123456/);
    }
  });
  it('single-flights duplicate code requests without deduplicating later attempts', async () => {
    let resolve!: (value: { challengeId: string; retryAfterSeconds: number }) => void;
    const request = vi.fn(() => new Promise(resolvePromise => { resolve = resolvePromise; }));
    const client = new AuthClient({ request } as HttpTransport, new FlowCoordinator());
    const input = { email: 'ada@example.com', deviceInstallationId: 'device' };
    const first = client.requestLoginCode(input);
    const duplicate = client.requestLoginCode(input);
    expect(request).toHaveBeenCalledTimes(1);
    resolve({ challengeId: 'challenge', retryAfterSeconds: 30 });
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { challengeId: 'challenge', retryAfterSeconds: 30 },
      { challengeId: 'challenge', retryAfterSeconds: 30 },
    ]);
    request.mockResolvedValueOnce({ challengeId: 'next', retryAfterSeconds: 30 });
    await client.requestLoginCode(input);
    expect(request).toHaveBeenCalledTimes(2);
  });

});
