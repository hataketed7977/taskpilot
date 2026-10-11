import { describe, expect, it } from 'vitest';
import {
  KeyringCredentialStore,
  type NativeCredentialEntry,
  type NativeCredentialEntryFactory,
} from '../../src/main/credentials/credential-store.js';

const credential = (userId: string, refreshToken = `refresh-${userId}`) => ({
  userId,
  refreshToken,
  refreshTokenExpiresAt: '2030-01-01T00:00:00Z',
});

class FakeEntry implements NativeCredentialEntry {
  constructor(
    private readonly key: string,
    private readonly values: Map<string, string>,
    private readonly writes: string[],
    private readonly failWrites: Set<string>,
    private readonly failDeletes: Set<string>,
  ) {}

  async getPassword() {
    return this.values.get(this.key) ?? null;
  }

  async setPassword(value: string) {
    if (this.failWrites.has(this.key)) throw new Error('native credential write failed');
    this.values.set(this.key, value);
    this.writes.push(this.key);
  }

  async deletePassword() {
    if (this.failDeletes.has(this.key)) throw new Error('native credential delete failed');
    return this.values.delete(this.key);
  }
}

function fakeKeyring() {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const failWrites = new Set<string>();
  const failDeletes = new Set<string>();
  const factory: NativeCredentialEntryFactory = (service, account) =>
    new FakeEntry(`${service}/${account}`, values, writes, failWrites, failDeletes);
  return { factory, values, writes, failWrites, failDeletes };
}

describe('KeyringCredentialStore', () => {
  it('partitions credentials by environment and account in native entries', async () => {
    const keyring = fakeKeyring();
    const store = new KeyringCredentialStore(keyring.factory);

    await store.saveCurrent('production', credential('user-a'));
    await store.saveCurrent('local', credential('user-b'));

    await expect(store.loadCurrent('production')).resolves.toEqual(credential('user-a'));
    await expect(store.loadCurrent('local')).resolves.toEqual(credential('user-b'));
    expect([...keyring.values.keys()]).toEqual(expect.arrayContaining([
      'ai.taskpilot.desktop.session.production/account:user-a',
      'ai.taskpilot.desktop.session.production/current-account',
      'ai.taskpilot.desktop.session.local/account:user-b',
      'ai.taskpilot.desktop.session.local/current-account',
    ]));
  });

  it('atomically replaces the refresh token in the current account entry', async () => {
    const keyring = fakeKeyring();
    const store = new KeyringCredentialStore(keyring.factory);
    await store.saveCurrent('production', credential('user-a'));
    keyring.writes.length = 0;

    await store.saveCurrent('production', credential('user-a', 'refresh-rotated'));

    expect(keyring.writes).toEqual(['ai.taskpilot.desktop.session.production/account:user-a']);
    const stored = keyring.values.get('ai.taskpilot.desktop.session.production/account:user-a');
    expect(JSON.parse(stored ?? '{}')).toMatchObject({
      version: 1,
      refreshToken: 'refresh-rotated',
    });
  });

  it('rolls back a newly written account credential when the current-account pointer cannot be saved', async () => {
    const keyring = fakeKeyring();
    const store = new KeyringCredentialStore(keyring.factory);
    keyring.failWrites.add('ai.taskpilot.desktop.session.production/current-account');

    await expect(store.saveCurrent('production', credential('user-a'))).rejects.toThrow('native credential write failed');

    expect(keyring.values.has('ai.taskpilot.desktop.session.production/account:user-a')).toBe(false);
    await expect(store.loadCurrent('production')).resolves.toBeUndefined();
  });

  it('deletes both the account credential and current-account pointer without a file fallback', async () => {
    const keyring = fakeKeyring();
    const store = new KeyringCredentialStore(keyring.factory);
    await store.saveCurrent('production', credential('user-a'));

    await store.clearCurrent('production');

    await expect(store.loadCurrent('production')).resolves.toBeUndefined();
    expect(keyring.values.size).toBe(0);
  });

  it('keeps a restarted process signed out when deleting the account credential fails', async () => {
    const keyring = fakeKeyring();
    const store = new KeyringCredentialStore(keyring.factory);
    await store.saveCurrent('production', credential('user-a'));
    keyring.failDeletes.add('ai.taskpilot.desktop.session.production/account:user-a');

    await expect(store.clearCurrent('production')).rejects.toThrow('native credential delete failed');

    const restartedStore = new KeyringCredentialStore(keyring.factory);
    await expect(restartedStore.loadCurrent('production')).resolves.toBeUndefined();
    expect(keyring.values.has('ai.taskpilot.desktop.session.production/account:user-a')).toBe(true);

    keyring.failDeletes.clear();
    await restartedStore.clearCurrent('production');
    expect(keyring.values.size).toBe(0);
  });

  it('cleans a signed-out account before establishing a later account', async () => {
    const keyring = fakeKeyring();
    const store = new KeyringCredentialStore(keyring.factory);
    await store.saveCurrent('production', credential('user-a'));
    keyring.failDeletes.add('ai.taskpilot.desktop.session.production/account:user-a');
    await expect(store.clearCurrent('production')).rejects.toThrow('native credential delete failed');
    keyring.failDeletes.clear();

    await store.saveCurrent('production', credential('user-b'));

    await expect(store.loadCurrent('production')).resolves.toEqual(credential('user-b'));
    expect(keyring.values.has('ai.taskpilot.desktop.session.production/account:user-a')).toBe(false);
  });

  it('fails closed for malformed native credential data', async () => {
    const keyring = fakeKeyring();
    keyring.values.set('ai.taskpilot.desktop.session.production/current-account', 'user-a');
    keyring.values.set('ai.taskpilot.desktop.session.production/account:user-a', '{"refreshToken":42}');
    const store = new KeyringCredentialStore(keyring.factory);

    await expect(store.loadCurrent('production')).rejects.toThrow('Invalid OS credential');
  });
});
