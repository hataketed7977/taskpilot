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
    expect(logout).toHaveBeenCalledWith('access-1');
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
    const logout = vi.fn().mockResolvedValue(undefined);
    const coordinator = new SessionCoordinator('production', store, {
      refresh: vi.fn(() => pending.promise), logout,
    });
    await coordinator.establish(issued());
    const refreshing = coordinator.refresh();
    await vi.waitFor(() => expect(coordinator.view().status).toBe('authenticated'));

    await coordinator.logout();
    pending.resolve(issued('late'));
    await refreshing;

    expect(coordinator.view()).toEqual({ status: 'signedOut' });
    expect(await store.loadCurrent('production')).toBeUndefined();
    expect(logout).toHaveBeenCalledWith('access-1');
    expect(logout).toHaveBeenCalledWith('access-late');
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

  it('fails closed after an ambiguous refresh network result', async () => {
    const store = new MemoryCredentialStore();
    const coordinator = new SessionCoordinator('production', store, {
      refresh: vi.fn().mockRejectedValue(new TypeError('offline')), logout: vi.fn(),
    });
    await coordinator.establish(issued());

    await expect(coordinator.refresh()).rejects.toBeInstanceOf(TypeError);

    expect(await store.loadCurrent('production')).toBeUndefined();
    expect(coordinator.view()).toEqual({ status: 'signedOut' });
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

    expect(logout).toHaveBeenCalledWith('access-2');
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
    expect(logout).toHaveBeenCalledWith('access-1');
  });

  it('exposes best-effort revocation for superseded OAuth results', async () => {
    const logout = vi.fn().mockRejectedValue(new TypeError('offline'));
    const coordinator = new SessionCoordinator('production', new MemoryCredentialStore(), {
      refresh: vi.fn(), logout,
    });

    await expect(coordinator.revokeIssued(issued())).resolves.toBeUndefined();
    expect(logout).toHaveBeenCalledWith('access-1');
  });
});
