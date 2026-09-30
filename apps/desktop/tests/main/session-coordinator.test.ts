import { describe, expect, it, vi } from 'vitest';
import { MemoryCredentialStore } from '../../src/main/credentials/credential-store.js';
import { SessionCoordinator } from '../../src/main/session/session-coordinator.js';

const user = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada', email: 'ada@example.com' };
const issued = (suffix = '1') => ({ accessToken: `access-${suffix}`, accessTokenExpiresAt: '2030-01-01T00:00:00Z', refreshToken: `refresh-${suffix}`, refreshTokenExpiresAt: '2030-02-01T00:00:00Z', currentUser: user });

describe('SessionCoordinator', () => {
  it('publishes authentication only after refresh credential is saved', async () => {
    const store = new MemoryCredentialStore();
    store.failWrites = true;
    const revoke = vi.fn();
    const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn(), logout: revoke });
    await expect(coordinator.establish(issued())).rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
    expect(revoke).toHaveBeenCalled();
  });

  it('persists pending request id before refresh and reuses it after restart', async () => {
    const store = new MemoryCredentialStore();
    const refresh = vi.fn().mockResolvedValue(issued('2'));
    const first = new SessionCoordinator('production', store, { refresh, logout: vi.fn() }, () => 'request-id');
    await first.establish(issued());
    refresh.mockRejectedValueOnce(new Error('connection lost'));
    await expect(first.refresh()).rejects.toBeTruthy();
    expect((await store.loadCurrent('production'))?.pendingRefreshRequestId).toBe('request-id');
    refresh.mockResolvedValueOnce(issued('2'));
    const restarted = new SessionCoordinator('production', store, { refresh, logout: vi.fn() }, () => 'other-id');
    await restarted.restore();
    expect(refresh).toHaveBeenLastCalledWith('refresh-1', 'request-id');
    expect(restarted.view()).toMatchObject({ status: 'authenticated', currentUser: user });
  });

  it('single-flights concurrent 401 recovery and retries each protected request once', async () => {
    const store = new MemoryCredentialStore();
    const refresh = vi.fn().mockResolvedValue(issued('2'));
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() }, () => 'request-id');
    await coordinator.establish(issued());
    const calls = new Map<string, number>();
    const operation = (name: string) => vi.fn(async () => {
      const count = calls.get(name) ?? 0; calls.set(name, count + 1);
      if (count === 0) throw Object.assign(new Error('401'), { status: 401 });
      return name;
    });
    await expect(Promise.all([coordinator.protected(operation('a')), coordinator.protected(operation('b'))])).resolves.toEqual(['a', 'b']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('invalidates generation before remote logout so late refresh cannot republish state', async () => {
    const store = new MemoryCredentialStore();
    let resolveRefresh!: (value: ReturnType<typeof issued>) => void;
    const refresh = vi.fn(() => new Promise<ReturnType<typeof issued>>(resolve => { resolveRefresh = resolve; }));
    const revoke = vi.fn().mockResolvedValue(undefined);
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: revoke }, () => 'request-id');
    await coordinator.establish(issued());
    const pending = coordinator.refresh().catch(() => undefined);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await coordinator.logout();
    resolveRefresh(issued('late'));
    await pending;
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
    expect(await store.loadCurrent('production')).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('access-1');
    expect(revoke).toHaveBeenCalledWith('access-late');
  });

  it('serializes logout after an in-progress rotated credential write', async () => {
    const store = new MemoryCredentialStore();
    const originalSave = store.saveCurrent.bind(store);
    let releaseRotatedWrite!: () => void;
    const rotatedWriteStarted = Promise.withResolvers<void>();
    const rotatedWriteRelease = new Promise<void>(resolve => { releaseRotatedWrite = resolve; });
    store.saveCurrent = vi.fn(async (environment, value) => {
      if (value.refreshToken === 'refresh-2') {
        rotatedWriteStarted.resolve();
        await rotatedWriteRelease;
      }
      await originalSave(environment, value);
    });
    const revoke = vi.fn().mockResolvedValue(undefined);
    const coordinator = new SessionCoordinator(
      'production', store, { refresh: vi.fn().mockResolvedValue(issued('2')), logout: revoke }, () => 'request-id',
    );
    await coordinator.establish(issued());

    const refresh = coordinator.refresh();
    await rotatedWriteStarted.promise;
    const logout = coordinator.logout();
    releaseRotatedWrite();
    await Promise.all([refresh, logout]);

    expect(coordinator.view()).toEqual({ status: 'signedOut' });
    expect(await store.loadCurrent('production')).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('access-2');
  });
});

it('does not publish or retain protected state when rotated credential persistence fails', async () => {
  const store = new MemoryCredentialStore();
  const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn().mockResolvedValue(issued('2')), logout: vi.fn() }, () => 'request-id');
  await coordinator.establish(issued());
  store.failWrites = true;
  await expect(coordinator.refresh()).rejects.toBeTruthy();
  expect(coordinator.view()).toEqual({ status: 'temporarilyUnavailable' });
  await expect(coordinator.protected(async () => 'stale')).rejects.toThrow('AUTHENTICATION_REQUIRED');
});

it('clears credentials and signs out on a terminal refresh rejection', async () => {
  const store = new MemoryCredentialStore();
  const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn().mockRejectedValue(Object.assign(new Error('revoked'), { status: 401 })), logout: vi.fn() }, () => 'request-id');
  await coordinator.establish(issued());
  await expect(coordinator.refresh()).rejects.toBeTruthy();
  expect(coordinator.view()).toEqual({ status: 'signedOut' });
  expect(await store.loadCurrent('production')).toBeUndefined();
});

it('restores signed-out state when there is no credential and allows listeners to unsubscribe', async () => {
  const store = new MemoryCredentialStore();
  const coordinator = new SessionCoordinator('local', store, { refresh: vi.fn(), logout: vi.fn() });
  const listener = vi.fn();
  const unsubscribe = coordinator.subscribe(listener);
  await coordinator.restore();
  expect(listener).toHaveBeenNthCalledWith(1, { status: 'restoring' });
  expect(listener).toHaveBeenNthCalledWith(2, { status: 'signedOut' });
  unsubscribe();
  await coordinator.restore();
  expect(listener).toHaveBeenCalledTimes(2);
});

it('does not refresh non-401 failures and retries a protected operation at most once', async () => {
  const store = new MemoryCredentialStore();
  const refresh = vi.fn().mockResolvedValue(issued('2'));
  const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() }, () => 'request-id');
  await coordinator.establish(issued());
  const temporary = Object.assign(new Error('down'), { status: 503 });
  await expect(coordinator.protected(async () => { throw temporary; })).rejects.toBe(temporary);
  expect(refresh).not.toHaveBeenCalled();

  const alwaysUnauthorized = vi.fn().mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
  await expect(coordinator.protected(alwaysUnauthorized)).rejects.toMatchObject({ status: 401 });
  expect(alwaysUnauthorized).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('clears account-scoped protected state before publishing explicit logout', async () => {
  const store = new MemoryCredentialStore();
  const order: string[] = [];
  const clearProtectedState = vi.fn(async (userId: string) => { order.push(`clear:${userId}`); });
  const coordinator = new SessionCoordinator(
    'production', store, { refresh: vi.fn(), logout: vi.fn().mockResolvedValue(undefined) }, () => 'request-id', { clearProtectedState },
  );
  coordinator.subscribe(view => { if (view.status === 'signedOut') order.push('publish:signedOut'); });
  await coordinator.establish(issued());
  await coordinator.logout();
  expect(clearProtectedState).toHaveBeenCalledWith(user.userId);
  expect(order).toEqual([`clear:${user.userId}`, 'publish:signedOut']);
});

it('clears account-scoped protected state when refresh proves the session is revoked', async () => {
  const store = new MemoryCredentialStore();
  const clearProtectedState = vi.fn().mockResolvedValue(undefined);
  const coordinator = new SessionCoordinator(
    'production', store,
    { refresh: vi.fn().mockRejectedValue(Object.assign(new Error('revoked'), { status: 401 })), logout: vi.fn() },
    () => 'request-id', { clearProtectedState },
  );
  await coordinator.establish(issued());
  await expect(coordinator.refresh()).rejects.toBeTruthy();
  expect(clearProtectedState).toHaveBeenCalledWith(user.userId);
});

it('finishes terminal 401 cleanup when physical credential deletion reports failure', async () => {
  const store = new MemoryCredentialStore();
  const clearProtectedState = vi.fn().mockResolvedValue(undefined);
  const coordinator = new SessionCoordinator(
    'production', store,
    { refresh: vi.fn().mockRejectedValue(Object.assign(new Error('revoked'), { status: 401 })), logout: vi.fn() },
    () => 'request-id', { clearProtectedState },
  );
  await coordinator.establish(issued());
  store.failDeletes = true;

  await expect(coordinator.refresh()).rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });

  expect(coordinator.view()).toEqual({ status: 'signedOut' });
  await expect(coordinator.protected(async () => 'stale')).rejects.toThrow('AUTHENTICATION_REQUIRED');
  expect(clearProtectedState).toHaveBeenCalledWith(user.userId);
});

it('publishes a recoverable unavailable state when the OS credential store cannot be read during startup', async () => {
  const store = new MemoryCredentialStore();
  const loadFailure = new Error('credential store locked');
  store.loadCurrent = vi.fn().mockRejectedValue(loadFailure);
  const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn(), logout: vi.fn() });

  await expect(coordinator.restore()).rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
  expect(coordinator.view()).toEqual({ status: 'temporarilyUnavailable' });
});

it('invalidates local state and attempts remote revocation when OS credential deletion fails', async () => {
  const store = new MemoryCredentialStore();
  const revoke = vi.fn().mockResolvedValue(undefined);
  const clearProtectedState = vi.fn().mockResolvedValue(undefined);
  const coordinator = new SessionCoordinator(
    'production', store, { refresh: vi.fn(), logout: revoke }, () => 'request-id', { clearProtectedState },
  );
  await coordinator.establish(issued());
  store.failDeletes = true;

  await expect(coordinator.logout()).rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });

  expect(coordinator.view()).toEqual({ status: 'signedOut' });
  await expect(coordinator.protected(async () => 'stale')).rejects.toThrow('AUTHENTICATION_REQUIRED');
  expect(clearProtectedState).toHaveBeenCalledWith(user.userId);
  expect(revoke).toHaveBeenCalledWith('access-1');
});
