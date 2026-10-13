import { describe, expect, it } from 'vitest';
import { KeyringFederatedAuthRecoveryStore, MemoryFederatedAuthRecoveryStore } from '../../src/main/auth/auth-recovery-store.js';

const nonce = 'abcdefghijklmnopqrstuvwxyzABCDEF';
const recovery = {
  version: 1 as const,
  flowId: 'flow-id', attemptId: 'attempt-id', pollSecret: 'poll-secret-value',
  authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=client',
  completionUri: `http://127.0.0.1:50000/taskpilot/oauth/complete/${nonce}`,
  loopbackNonce: nonce, expiresAt: '2030-01-01T00:00:00Z',
};

class Entry {
  value: string | null = null;
  async getPassword() { return this.value; }
  async setPassword(value: string) { this.value = value; }
  async deletePassword() { this.value = null; }
}

describe('FederatedAuthRecoveryStore', () => {
  it('round-trips private OAuth attempt state by environment without sharing references', async () => {
    const store = new MemoryFederatedAuthRecoveryStore();
    await store.save('local', recovery);
    const loaded = await store.load('local');
    expect(loaded).toEqual(recovery);
    if (loaded) loaded.pollSecret = 'changed-secret-value';
    expect((await store.load('local'))?.pollSecret).toBe('poll-secret-value');
    expect(await store.load('production')).toBeUndefined();
  });

  it('uses a dedicated keyring namespace and rejects malformed registration secrets', async () => {
    const entry = new Entry();
    const calls: string[][] = [];
    const store = new KeyringFederatedAuthRecoveryStore((service, account) => {
      calls.push([service, account]); return entry;
    });
    await store.save('local', recovery);
    expect(calls[0]).toEqual(['ai.taskpilot.desktop.federated-auth.local', 'current-flow']);
    entry.value = JSON.stringify({
      ...recovery,
      registration: {
        continuationId: 'id', continuationSecret: 'short', suggestedDisplayName: 'Ada',
        legalBundleVersion: 'v1', termsVersion: 'terms-v1', privacyVersion: 'privacy-v1',
        legalLocales: ['zh-CN'], expiresAt: '2031-01-01T00:00:00Z',
      },
    });
    await expect(store.load('local')).rejects.toThrow('Invalid federated auth recovery');
  });

  it('round-trips the complete legal requirement for a pending registration', async () => {
    const store = new MemoryFederatedAuthRecoveryStore();
    const pending = {
      ...recovery,
      registration: {
        continuationId: 'continuation-id', continuationSecret: 'continuation-secret-value',
        suggestedDisplayName: 'Ada', legalBundleVersion: 'v1', termsVersion: 'terms-v1',
        privacyVersion: 'privacy-v1', legalLocales: ['zh-CN', 'en'], expiresAt: '2031-01-01T00:00:00Z',
      },
    };
    await store.save('local', pending);
    expect((await store.load('local'))?.registration).toEqual(pending.registration);
  });

  it.each([
    ['missing terms version', { privacyVersion: 'privacy-v1', legalLocales: ['zh-CN'] }],
    ['missing privacy version', { termsVersion: 'terms-v1', legalLocales: ['zh-CN'] }],
    ['empty terms version', { termsVersion: '', privacyVersion: 'privacy-v1', legalLocales: ['zh-CN'] }],
    ['empty privacy version', { termsVersion: 'terms-v1', privacyVersion: '', legalLocales: ['zh-CN'] }],
    ['empty legal locales', { termsVersion: 'terms-v1', privacyVersion: 'privacy-v1', legalLocales: [] }],
    ['duplicate legal locales', { termsVersion: 'terms-v1', privacyVersion: 'privacy-v1', legalLocales: ['zh-CN', 'zh-CN'] }],
    ['invalid legal locales', { termsVersion: 'terms-v1', privacyVersion: 'privacy-v1', legalLocales: ['zh-CN', 1] }],
    ['non-array legal locales', { termsVersion: 'terms-v1', privacyVersion: 'privacy-v1', legalLocales: 'zh-CN' }],
  ])('rejects a registration recovery with %s', async (_case, legalRequirement) => {
    const store = new MemoryFederatedAuthRecoveryStore();
    await expect(store.save('local', {
      ...recovery,
      registration: {
        continuationId: 'continuation-id', continuationSecret: 'continuation-secret-value',
        suggestedDisplayName: 'Ada', legalBundleVersion: 'v1', expiresAt: '2031-01-01T00:00:00Z',
        ...legalRequirement,
      },
    } as never)).rejects.toThrow('Invalid federated auth recovery');
  });

  it('rejects unsafe authorization and completion URLs', async () => {
    const store = new MemoryFederatedAuthRecoveryStore();
    await expect(store.save('local', {
      ...recovery, authorizationUrl: 'https://evil.test/login/oauth/authorize',
    })).rejects.toThrow();
    await expect(store.save('local', {
      ...recovery, completionUri: `http://localhost:50000/taskpilot/oauth/complete/${nonce}`,
    })).rejects.toThrow();
  });
});
