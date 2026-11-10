import { describe, expect, it, vi } from 'vitest';
import { MemoryCredentialStore } from '../../../src/main/credentials/credential-store.js';
import { SessionCoordinator } from '../../../src/main/session/session-coordinator.js';

const user = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' };
const issued = (suffix = '1') => ({
  accessToken: `access-${suffix}`, accessTokenExpiresAt: '2030-01-01T00:00:00Z',
  refreshToken: `refresh-${suffix}`, refreshTokenExpiresAt: '2030-02-01T00:00:00Z', currentUser: user,
});

describe('SessionCoordinator', () => {
  it('publishes authentication only after the refresh credential is saved', async () => {
    const store = new MemoryCredentialStore();
    const observed: string[] = [];
    const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn(), logout: vi.fn() });
    coordinator.subscribe(view => observed.push(view.status));

    await coordinator.establish(issued());

    expect(await store.loadCurrent('production')).toMatchObject({ refreshToken: 'refresh-1' });
    expect(observed).toEqual(['authenticated']);
  });

  it('revokes the issued session and stays signed out when credential persistence fails', async () => {
    const store = new MemoryCredentialStore();
    store.failWrites = true;
    const logout = vi.fn();
    const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn(), logout });

    await expect(coordinator.establish(issued())).rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
    expect(logout).toHaveBeenCalledWith('refresh-1');
  });

  it('restores by rotating with only the stored opaque refresh token', async () => {
    const store = new MemoryCredentialStore();
    await store.saveCurrent('production', {
      userId: user.userId, refreshToken: 'refresh-1', refreshTokenExpiresAt: '2030-02-01T00:00:00Z',
    });
    const refresh = vi.fn().mockResolvedValue(issued('2'));
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() });

    await coordinator.restore();

    expect(refresh).toHaveBeenCalledWith('refresh-1');
    expect(await store.loadCurrent('production')).toMatchObject({ refreshToken: 'refresh-2' });
    expect(coordinator.view()).toEqual({ status: 'authenticated', currentUser: user });
  });

  it('single-flights concurrent 401 recovery and retries each protected request once', async () => {
    const store = new MemoryCredentialStore();
    const refresh = vi.fn().mockResolvedValue(issued('2'));
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() });
    await coordinator.establish(issued());
    const calls = new Map<string, number>();
    const operation = (name: string) => vi.fn(async () => {
      const count = calls.get(name) ?? 0;
      calls.set(name, count + 1);
      if (count === 0) throw Object.assign(new Error('401'), { status: 401 });
      return name;
    });

    await expect(Promise.all([
      coordinator.protected(operation('a')), coordinator.protected(operation('b')),
    ])).resolves.toEqual(['a', 'b']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('assigns a new generation to an established identity and rejects responses from the previous one', async () => {
    const coordinator = new SessionCoordinator('production', new MemoryCredentialStore(), {
      refresh: vi.fn(), logout: vi.fn(),
    });
    await coordinator.establish(issued('1'));
    const previous = coordinator.context();
    await coordinator.establish({ ...issued('2'), currentUser: { userId: '22222222-2222-4222-8222-222222222222', displayName: 'Grace' } });

    expect(coordinator.context()).toMatchObject({ user: { displayName: 'Grace' } });
    expect(() => coordinator.assertCurrent(previous)).toThrowError(expect.objectContaining({ code: 'SESSION_CONTEXT_SUPERSEDED' }));
  });

  it('invalidates the generation before logout so a late refresh cannot republish state', async () => {
    const store = new MemoryCredentialStore();
    const pending = Promise.withResolvers<ReturnType<typeof issued>>();
    const refresh = vi.fn(() => pending.promise);
    const logout = vi.fn().mockResolvedValue(undefined);
    const coordinator = new SessionCoordinator('production', store, {
      refresh, logout,
    });
    await coordinator.establish(issued());
    const refreshing = coordinator.refresh();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());

    await coordinator.logout();
    pending.resolve(issued('late'));
    await refreshing;

    expect(coordinator.view()).toEqual({ status: 'signedOut' });
    expect(await store.loadCurrent('production')).toBeUndefined();
    expect(logout).toHaveBeenCalledWith('refresh-1');
    expect(logout).toHaveBeenCalledWith('refresh-late');
  });

  it('clears credentials and signs out when refresh is rejected', async () => {
    const store = new MemoryCredentialStore();
    const coordinator = new SessionCoordinator('production', store, {
      refresh: vi.fn().mockRejectedValue(Object.assign(new Error('revoked'), { status: 401 })), logout: vi.fn(),
    });
    await coordinator.establish(issued());

    await expect(coordinator.refresh()).rejects.toMatchObject({ status: 401 });

    expect(await store.loadCurrent('production')).toBeUndefined();
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
  });

  it('keeps a potentially valid credential after an ambiguous refresh network result', async () => {
    const store = new MemoryCredentialStore();
    const coordinator = new SessionCoordinator('production', store, {
      refresh: vi.fn().mockRejectedValue(new TypeError('offline')), logout: vi.fn(),
    });
    await coordinator.establish(issued());

    await expect(coordinator.refresh()).rejects.toBeInstanceOf(TypeError);

    expect(await store.loadCurrent('production')).toEqual(expect.objectContaining({
      userId: '11111111-1111-4111-8111-111111111111',
      refreshToken: 'refresh-1',
    }));
    expect(coordinator.view()).toEqual({ status: 'temporarilyUnavailable' });
  });

  it('fails closed and revokes the rotated session when saving it fails', async () => {
    const store = new MemoryCredentialStore();
    const logout = vi.fn().mockResolvedValue(undefined);
    const coordinator = new SessionCoordinator('production', store, {
      refresh: vi.fn().mockResolvedValue(issued('2')), logout,
    });
    await coordinator.establish(issued());
    store.failWrites = true;

    await expect(coordinator.refresh()).rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });

    expect(logout).toHaveBeenCalledWith('refresh-2');
    expect(await store.loadCurrent('production')).toBeUndefined();
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
  });

  it('publishes temporarily unavailable when startup credential loading fails', async () => {
    const store = new MemoryCredentialStore();
    store.loadCurrent = vi.fn().mockRejectedValue(new Error('credential store locked'));
    const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn(), logout: vi.fn() });

    await expect(coordinator.restore()).rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
    expect(coordinator.view()).toEqual({ status: 'temporarilyUnavailable' });
  });

  it('clears local state and best-effort revokes the active access token on logout', async () => {
    const store = new MemoryCredentialStore();
    const logout = vi.fn().mockRejectedValue(new TypeError('offline'));
    const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn(), logout });
    await coordinator.establish(issued());

    await coordinator.logout();

    expect(coordinator.view()).toEqual({ status: 'signedOut' });
    expect(await store.loadCurrent('production')).toBeUndefined();
    expect(logout).toHaveBeenCalledWith('refresh-1');
  });

  it('exposes best-effort revocation for superseded OAuth results', async () => {
    const logout = vi.fn().mockRejectedValue(new TypeError('offline'));
    const coordinator = new SessionCoordinator('production', new MemoryCredentialStore(), {
      refresh: vi.fn(), logout,
    });

    await expect(coordinator.revokeIssued(issued())).resolves.toBeUndefined();
    expect(logout).toHaveBeenCalledWith('refresh-1');
  });
});

describe('session recovery races', () => {
  it('shares startup restore and protected refresh through credential loading', async () => {
    const store = new MemoryCredentialStore();
    const loaded = Promise.withResolvers<Awaited<ReturnType<typeof store.loadCurrent>>>();
    const originalLoad = store.loadCurrent.bind(store);
    const refresh = vi.fn().mockResolvedValue(issued('2'));
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() });
    await coordinator.establish(issued());
    const credential = await originalLoad('production');
    store.loadCurrent = vi.fn(() => loaded.promise);
    const restoring = coordinator.restore();
    const refreshing = coordinator.refresh();
    loaded.resolve(credential);
    await Promise.all([restoring, refreshing]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.loadCurrent).toHaveBeenCalledTimes(1);
  });

  it('does not consume a credential loaded after logout and publishes signedOut before slow cleanup', async () => {
    const store = new MemoryCredentialStore();
    const loaded = Promise.withResolvers<Awaited<ReturnType<typeof store.loadCurrent>>>();
    const refresh = vi.fn().mockResolvedValue(issued('late'));
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() });
    await coordinator.establish(issued());
    const credential = await store.loadCurrent('production');
    store.loadCurrent = vi.fn(() => loaded.promise);
    const restoring = coordinator.restore();
    const signingOut = coordinator.logout();
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
    loaded.resolve(credential);
    await Promise.all([restoring, signingOut]);
    expect(refresh).not.toHaveBeenCalled();
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
  });
});

describe('retry and logout storage ordering', () => {
  it('retries temporary recovery but no-ops after authentication or sign-out', async () => {
    const store = new MemoryCredentialStore();
    const refresh = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(issued('2'));
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() });
    await coordinator.establish(issued());
    await expect(coordinator.restore()).rejects.toThrow('offline');
    await expect(coordinator.retrySessionRestore()).resolves.toMatchObject({ status: 'authenticated' });
    await coordinator.retrySessionRestore();
    expect(refresh).toHaveBeenCalledTimes(2);
    await coordinator.logout();
    await coordinator.retrySessionRestore();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('queues logout read and clear before a new account save, even when the old read fails', async () => {
    const store = new MemoryCredentialStore();
    const load = Promise.withResolvers<undefined>();
    const logout = vi.fn().mockResolvedValue(undefined);
    const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn(), logout });
    await coordinator.establish(issued());
    store.loadCurrent = vi.fn(() => load.promise);
    const signingOut = coordinator.logout().catch(error => error);
    const newAccount = coordinator.establish(issued('new'));
    load.reject(new Error('locked'));
    expect(await signingOut).toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
    await newAccount;
    expect(coordinator.view()).toMatchObject({ status: 'authenticated' });
    expect(logout).toHaveBeenCalledWith(undefined, 'access-1');
    store.loadCurrent = MemoryCredentialStore.prototype.loadCurrent;
    expect(await store.loadCurrent('production')).toMatchObject({ refreshToken: 'refresh-new' });
  });

  it('revokes captured refresh even when clearing fails', async () => {
    const store = new MemoryCredentialStore();
    const logout = vi.fn().mockRejectedValue(new TypeError('offline'));
    const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn(), logout });
    await coordinator.establish(issued());
    store.clearCurrent = vi.fn().mockRejectedValue(new Error('locked'));
    await expect(coordinator.logout()).rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
    expect(logout).toHaveBeenCalledWith('refresh-1');
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
  });

  it('keeps a new generation flight when the old flight finally settles', async () => {
    const store = new MemoryCredentialStore();
    const old = Promise.withResolvers<ReturnType<typeof issued>>();
    const next = Promise.withResolvers<ReturnType<typeof issued>>();
    const refresh = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => next.promise);
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() });
    await coordinator.establish(issued());
    const first = coordinator.refresh();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await coordinator.logout();
    await coordinator.establish(issued('new'));
    const second = coordinator.refresh();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    old.resolve(issued('late'));
    await first;
    const joined = coordinator.refresh();
    next.resolve(issued('current'));
    await Promise.all([second, joined]);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(await store.loadCurrent('production')).toMatchObject({ refreshToken: 'refresh-current' });
  });

  it.each(['resolve', 'reject'])('fences late credential load %s after account replacement', async outcome => {
    const store = new MemoryCredentialStore();
    const load = Promise.withResolvers<Awaited<ReturnType<typeof store.loadCurrent>>>();
    store.loadCurrent = vi.fn(() => load.promise);
    const refresh = vi.fn();
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() });
    const restoring = coordinator.restore();
    await vi.waitFor(() => expect(store.loadCurrent).toHaveBeenCalledOnce());
    await coordinator.establish(issued('new'));
    if (outcome === 'resolve') load.resolve({ userId: user.userId, refreshToken: 'old', refreshTokenExpiresAt: '2030-01-01T00:00:00Z' });
    else load.reject(new Error('locked'));
    await restoring;
    expect(refresh).not.toHaveBeenCalled();
    expect(coordinator.view()).toEqual({ status: 'authenticated', currentUser: user });
  });

  it('fences delayed startup intent after logout and after a new login', async () => {
    const store = new MemoryCredentialStore();
    const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn(), logout: vi.fn() });
    const startup = coordinator.recoveryGeneration();
    await coordinator.logout();
    store.loadCurrent = vi.fn().mockRejectedValue(new Error('must not load'));
    await coordinator.restore(startup);
    expect(store.loadCurrent).not.toHaveBeenCalled();
    await coordinator.establish(issued('new'));
    await coordinator.restore(startup);
    expect(store.loadCurrent).not.toHaveBeenCalled();
    expect(coordinator.view().status).toBe('authenticated');
  });

  it('keeps a newer save after in-flight old save and logout cleanup', async () => {
    const store = new MemoryCredentialStore();
    const saved = Promise.withResolvers<void>();
    const originalSave = store.saveCurrent.bind(store);
    const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn().mockResolvedValue(issued('rotated')), logout: vi.fn() });
    await coordinator.establish(issued());
    store.saveCurrent = vi.fn().mockImplementationOnce(async (environment, credential) => {
      await saved.promise; await originalSave(environment, credential);
    }).mockImplementation(originalSave);
    const rotating = coordinator.refresh();
    await vi.waitFor(() => expect(store.saveCurrent).toHaveBeenCalledOnce());
    const leaving = coordinator.logout();
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
    const replacing = coordinator.establish(issued('new'));
    saved.resolve();
    await Promise.all([rotating, leaving, replacing]);
    expect(await store.loadCurrent('production')).toMatchObject({ refreshToken: 'refresh-new' });
    expect(coordinator.view().status).toBe('authenticated');
  });

  it('does not enqueue late terminal cleanup behind a new account save', async () => {
    const store = new MemoryCredentialStore();
    const pending = Promise.withResolvers<ReturnType<typeof issued>>();
    const refresh = vi.fn(() => pending.promise);
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() });
    await coordinator.establish(issued());
    const rotating = coordinator.refresh();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    await coordinator.logout();
    await coordinator.establish(issued('new'));
    pending.reject(Object.assign(new Error('401'), { status: 401 }));
    await rotating;
    expect(await store.loadCurrent('production')).toMatchObject({ refreshToken: 'refresh-new' });
    expect(coordinator.view().status).toBe('authenticated');
  });

  it.each([false, true])('revokes issued refresh on save failure and reports clear failure=%s', async clearFails => {
    const store = new MemoryCredentialStore();
    const logout = vi.fn();
    const coordinator = new SessionCoordinator('production', store, { refresh: vi.fn().mockResolvedValue(issued('rotated')), logout });
    await coordinator.establish(issued());
    store.saveCurrent = vi.fn().mockRejectedValue(new Error('locked'));
    if (clearFails) store.clearCurrent = vi.fn().mockRejectedValue(new Error('locked'));
    await expect(coordinator.refresh()).rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
    expect(logout).toHaveBeenCalledWith('refresh-rotated');
    expect(coordinator.view().status).toBe(clearFails ? 'temporarilyUnavailable' : 'signedOut');
    if (!clearFails) expect(await store.loadCurrent('production')).toBeUndefined();
  });

});

describe('whole-flight and response-loss recovery', () => {
  it('joins restore, refresh and Retry while secure save is pending', async () => {
    const store = new MemoryCredentialStore();
    const saved = Promise.withResolvers<void>();
    const refresh = vi.fn().mockResolvedValue(issued('2'));
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() });
    await coordinator.establish(issued());
    const originalSave = store.saveCurrent.bind(store);
    store.saveCurrent = vi.fn(async (environment, credential) => {
      await saved.promise;
      await originalSave(environment, credential);
    });
    const first = coordinator.restore();
    await vi.waitFor(() => expect(store.saveCurrent).toHaveBeenCalledOnce());
    const concurrent = [coordinator.restore(), coordinator.refresh(), coordinator.retrySessionRestore()];
    expect(coordinator.view()).toEqual({ status: 'restoring' });
    expect(refresh).toHaveBeenCalledOnce();
    saved.resolve();
    await Promise.all([first, ...concurrent]);
    expect(store.saveCurrent).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(coordinator.view()).toEqual({ status: 'authenticated', currentUser: user });
  });

  it('retains a lost-response credential until explicit Retry receives terminal replay rejection', async () => {
    const store = new MemoryCredentialStore();
    const refresh = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('response lost after server rotation'), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('used-token replay revoked family'), { status: 401 }));
    const coordinator = new SessionCoordinator('production', store, { refresh, logout: vi.fn() });
    await coordinator.establish(issued());
    await expect(coordinator.restore()).rejects.toMatchObject({ status: 503 });
    expect(coordinator.view()).toEqual({ status: 'temporarilyUnavailable' });
    expect(await store.loadCurrent('production')).toMatchObject({ refreshToken: 'refresh-1' });
    expect(refresh).toHaveBeenCalledOnce();
    await expect(coordinator.retrySessionRestore()).rejects.toMatchObject({ status: 401 });
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
    expect(await store.loadCurrent('production')).toBeUndefined();
    expect(refresh.mock.calls).toEqual([['refresh-1'], ['refresh-1']]);
    await coordinator.retrySessionRestore();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
