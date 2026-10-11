import { describe, expect, it, vi } from 'vitest';
import type { FederatedAuthClient, FederatedPollResponse } from '../../src/main/auth/auth-client.js';
import { MemoryFederatedAuthRecoveryStore } from '../../src/main/auth/auth-recovery-store.js';
import { FederatedAuthCoordinator } from '../../src/main/auth/federated-auth-coordinator.js';
import type { LoopbackHandle, LoopbackReceiver } from '../../src/main/auth/loopback-receiver.js';
import { MemoryCredentialStore } from '../../src/main/credentials/credential-store.js';
import { SessionCoordinator } from '../../src/main/session/session-coordinator.js';

const nonce = 'abcdefghijklmnopqrstuvwxyzABCDEF';
const completionUri = `http://127.0.0.1:50000/taskpilot/oauth/complete/${nonce}`;
const attempt = {
  attemptId: 'attempt-id', pollSecret: 'poll-secret-value',
  authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=client',
  expiresAt: '2030-01-01T00:00:00Z',
};
const issued = {
  accessToken: 'access-token', accessTokenExpiresAt: '2030-01-01T00:00:00Z',
  refreshToken: 'refresh-token', refreshTokenExpiresAt: '2030-02-01T00:00:00Z',
  currentUser: { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' },
};
const registration = {
  continuationId: 'continuation-id', continuationSecret: 'continuation-secret-value',
  suggestedDisplayName: 'Ada', suggestedAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  legalBundleVersion: '2026-01', expiresAt: '2031-01-01T00:00:00Z',
};

function receiverFixture(events: string[] = []) {
  const proof = Promise.withResolvers<string>();
  const close = vi.fn(async () => { events.push('close'); });
  const handle: LoopbackHandle = { completionUri, nonce, proof: proof.promise, close };
  const start = vi.fn(async (preferred?: { port: number; nonce: string }) => {
    events.push('listen');
    if (preferred) expect(preferred).toEqual({ port: 50000, nonce });
    return handle;
  });
  return { proof, handle, start, receiver: { start } as unknown as LoopbackReceiver };
}

function clientFixture(events: string[] = [], poll: FederatedPollResponse = { status: 'WAITING' }) {
  return {
    capabilities: vi.fn().mockResolvedValue({ github: { enabled: true } }),
    createAttempt: vi.fn(async () => { events.push('attempt'); return attempt; }),
    poll: vi.fn().mockResolvedValue(poll),
    cancel: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue({ status: 'AUTHENTICATED', session: issued }),
  };
}

function fixture(options: {
  poll?: FederatedPollResponse;
  recovery?: MemoryFederatedAuthRecoveryStore;
  credentials?: MemoryCredentialStore;
  browser?: { open(url: string): Promise<void> };
  now?: () => number;
} = {}) {
  const events: string[] = [];
  const loopback = receiverFixture(events);
  const client = clientFixture(events, options.poll);
  const recovery = options.recovery ?? new MemoryFederatedAuthRecoveryStore();
  const credentials = options.credentials ?? new MemoryCredentialStore();
  const logout = vi.fn().mockResolvedValue(undefined);
  const session = new SessionCoordinator('local', credentials, { refresh: vi.fn(), logout });
  const browser = options.browser ?? { open: vi.fn(async () => { events.push('open'); }) };
  const activateDesktop = vi.fn();
  const coordinator = new FederatedAuthCoordinator(
    'local', 'installation-id', client as unknown as FederatedAuthClient, recovery, session,
    browser, loopback.receiver, () => '11111111-1111-4111-8111-111111111111',
    options.now ?? (() => Date.parse('2029-01-01T00:00:00Z')), activateDesktop,
  );
  return { coordinator, client, recovery, credentials, session, logout, browser, activateDesktop, loopback, events };
}

function flowId(view: Awaited<ReturnType<FederatedAuthCoordinator['start']>>) {
  if (view.status !== 'waiting') throw new Error('expected waiting flow');
  return view.flowId;
}

describe('FederatedAuthCoordinator', () => {
  it('starts the listener before attempt creation and persists before opening GitHub', async () => {
    const recovery = new MemoryFederatedAuthRecoveryStore();
    const browser = { open: vi.fn(async () => {
      expect(await recovery.load('local')).toMatchObject({ attemptId: attempt.attemptId });
    }) };
    const current = fixture({ browser, recovery });

    const view = await current.coordinator.start();

    expect(view).toMatchObject({ status: 'waiting', flowId: expect.any(String) });
    expect(current.events.slice(0, 2)).toEqual(['listen', 'attempt']);
    expect(browser.open).toHaveBeenCalledWith(attempt.authorizationUrl);
  });

  it('single-flights duplicate start requests', async () => {
    const current = fixture();

    await Promise.all([current.coordinator.start(), current.coordinator.start()]);

    expect(current.client.createAttempt).toHaveBeenCalledTimes(1);
    expect(current.browser.open).toHaveBeenCalledTimes(1);
  });

  it('persists completion proof before activating the Desktop and sends it on poll', async () => {
    const current = fixture();
    const started = await current.coordinator.start();

    current.loopback.proof.resolve('completion-proof-value');
    await vi.waitFor(async () => {
      expect((await current.recovery.load('local'))?.completionProof).toBe('completion-proof-value');
    });

    expect(current.activateDesktop).toHaveBeenCalledOnce();
    await current.coordinator.continue(flowId(started));
    expect(current.client.poll).toHaveBeenCalledWith(attempt.attemptId, {
      pollSecret: attempt.pollSecret, completionProof: 'completion-proof-value',
    });
  });

  it('keeps registration continuation private and exposes only a safe preview', async () => {
    const current = fixture({ poll: { status: 'REGISTRATION_REQUIRED', registration } });
    const started = await current.coordinator.start();

    const view = await current.coordinator.continue(flowId(started));

    expect(view).toEqual({
      status: 'registrationRequired', flowId: flowId(started), suggestedDisplayName: 'Ada',
      suggestedAvatarUrl: registration.suggestedAvatarUrl, legalBundleVersion: '2026-01',
    });
    expect(JSON.stringify(view)).not.toMatch(/continuation|secret|proof/i);
    expect((await current.recovery.load('local'))?.registration?.continuationSecret)
      .toBe(registration.continuationSecret);
  });

  it('establishes the returned opaque session and clears OAuth recovery', async () => {
    const current = fixture({ poll: { status: 'AUTHENTICATED', session: issued } });
    const started = await current.coordinator.start();

    await expect(current.coordinator.continue(flowId(started))).resolves.toEqual({
      status: 'authenticated', currentUser: issued.currentUser,
    });

    expect(await current.credentials.loadCurrent('local')).toEqual({
      userId: issued.currentUser.userId,
      refreshToken: issued.refreshToken,
      refreshTokenExpiresAt: issued.refreshTokenExpiresAt,
    });
    expect(await current.recovery.load('local')).toBeUndefined();
    expect(current.session.view()).toEqual({ status: 'authenticated', currentUser: issued.currentUser });
  });

  it('keeps the flow recoverable and revokes the issued session if credential saving fails', async () => {
    const credentials = new MemoryCredentialStore();
    credentials.failWrites = true;
    const current = fixture({ poll: { status: 'AUTHENTICATED', session: issued }, credentials });
    const started = await current.coordinator.start();

    await expect(current.coordinator.continue(flowId(started)))
      .rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });

    expect(current.logout).toHaveBeenCalledWith(issued.accessToken);
    expect(await current.recovery.load('local')).toBeDefined();
    expect(current.session.view()).toEqual({ status: 'signedOut' });
  });

  it.each(['FEDERATED_LOGIN_CONTEXT_INVALID', 'FEDERATED_LOGIN_EXPIRED'])(
    'clears stale local recovery when polling is rejected with %s',
    async (code) => {
      const current = fixture();
      const started = await current.coordinator.start();
      current.client.poll.mockRejectedValueOnce(Object.assign(new Error(code), { code }));

      await expect(current.coordinator.continue(flowId(started))).rejects.toMatchObject({ code });

      expect(await current.recovery.load('local')).toBeUndefined();
      expect(current.loopback.handle.close).toHaveBeenCalled();
      await expect(current.coordinator.start()).resolves.toMatchObject({ status: 'waiting' });
      expect(current.client.createAttempt).toHaveBeenCalledTimes(2);
    },
  );

  it('cancels the server attempt, clears local state, and invalidates the flow', async () => {
    const current = fixture();
    const started = await current.coordinator.start();
    const id = flowId(started);

    await current.coordinator.cancel(id);

    expect(current.client.cancel).toHaveBeenCalledWith(attempt.attemptId, attempt.pollSecret);
    expect(await current.recovery.load('local')).toBeUndefined();
    await expect(current.coordinator.continue(id)).rejects.toMatchObject({
      code: 'FEDERATED_LOGIN_CONTEXT_INVALID',
    });
  });

  it('replaces a locally restored attempt when the server has lost its Redis context', async () => {
    const first = fixture();
    await first.coordinator.start();
    const restarted = fixture({ recovery: first.recovery, credentials: first.credentials });
    restarted.client.poll.mockRejectedValueOnce(Object.assign(new Error('context lost'), {
      code: 'FEDERATED_LOGIN_CONTEXT_INVALID',
    }));

    await expect(restarted.coordinator.start()).resolves.toMatchObject({ status: 'waiting' });

    expect(restarted.client.poll).toHaveBeenCalledOnce();
    expect(restarted.client.createAttempt).toHaveBeenCalledOnce();
    expect(restarted.browser.open).toHaveBeenCalledOnce();
  });

  it('restores an unexpired attempt on the exact loopback port without reopening GitHub', async () => {
    const first = fixture();
    await first.coordinator.start();
    const restarted = fixture({ recovery: first.recovery, credentials: first.credentials });

    await expect(restarted.coordinator.restore()).resolves.toBe('attempt');

    expect(restarted.loopback.start).toHaveBeenCalledWith({ port: 50000, nonce });
    expect(restarted.client.createAttempt).not.toHaveBeenCalled();
    expect(restarted.browser.open).not.toHaveBeenCalled();
  });

  it('clears an expired restored attempt', async () => {
    const first = fixture();
    await first.coordinator.start();
    const restarted = fixture({
      recovery: first.recovery, credentials: first.credentials,
      now: () => Date.parse('2031-01-01T00:00:00Z'),
    });

    await expect(restarted.coordinator.restore()).resolves.toBe('none');

    expect(restarted.client.cancel).toHaveBeenCalledWith(attempt.attemptId, attempt.pollSecret);
    expect(await first.recovery.load('local')).toBeUndefined();
  });

  it('uses the server registration deadline and continuation when registering', async () => {
    let now = Date.parse('2029-01-01T00:00:00Z');
    const current = fixture({
      poll: { status: 'REGISTRATION_REQUIRED', registration }, now: () => now,
    });
    const started = await current.coordinator.start();
    const preview = await current.coordinator.continue(flowId(started));
    now = Date.parse('2030-06-01T00:00:00Z');

    await expect(current.coordinator.register({
      flowId: preview.status === 'registrationRequired' ? preview.flowId : '',
      displayName: 'Ada Lovelace', useSuggestedAvatar: false,
      legalBundleVersion: registration.legalBundleVersion,
      termsVersion: 'terms-v1', privacyVersion: 'privacy-v1', locale: 'zh-CN',
    })).resolves.toEqual({ status: 'authenticated', currentUser: issued.currentUser });

    expect(current.client.register).toHaveBeenCalledWith(expect.objectContaining({
      continuationId: registration.continuationId,
      continuationSecret: registration.continuationSecret,
      displayName: 'Ada Lovelace',
    }));
  });

  it('revokes a session returned after cancellation and never authenticates it', async () => {
    const current = fixture();
    const pending = Promise.withResolvers<FederatedPollResponse>();
    current.client.poll.mockReturnValueOnce(pending.promise);
    const started = await current.coordinator.start();
    const continuing = current.coordinator.continue(flowId(started));
    await vi.waitFor(() => expect(current.client.poll).toHaveBeenCalledOnce());

    await current.coordinator.cancel(flowId(started));
    pending.resolve({ status: 'AUTHENTICATED', session: issued });

    await expect(continuing).rejects.toMatchObject({ code: 'FEDERATED_LOGIN_CONTEXT_INVALID' });
    expect(current.logout).toHaveBeenCalledWith(issued.accessToken);
    expect(current.session.view()).toEqual({ status: 'signedOut' });
  });

  it('fails closed for an unsafe GitHub authorization URL', async () => {
    const current = fixture();
    current.client.createAttempt.mockResolvedValueOnce({
      ...attempt, authorizationUrl: 'https://evil.example/oauth',
    });

    await expect(current.coordinator.start()).rejects.toThrow('Unsafe federated authorization contract');

    expect(current.browser.open).not.toHaveBeenCalled();
    expect(current.client.cancel).toHaveBeenCalled();
    expect(await current.recovery.load('local')).toBeUndefined();
  });

  it('close cancels and clears the current attempt', async () => {
    const current = fixture();
    await current.coordinator.start();

    await current.coordinator.close();

    expect(current.client.cancel).toHaveBeenCalledWith(attempt.attemptId, attempt.pollSecret);
    expect(await current.recovery.load('local')).toBeUndefined();
    expect(current.loopback.handle.close).toHaveBeenCalled();
  });
});
