import type { Environment } from '../api/transport.js';
import type { NativeCredentialEntryFactory } from '../credentials/credential-store.js';

export interface RegistrationRecovery {
  continuationId: string;
  continuationSecret: string;
  suggestedDisplayName: string;
  suggestedAvatarUrl?: string;
  legalBundleVersion: string;
  termsVersion: string;
  privacyVersion: string;
  legalLocales: string[];
  expiresAt: string;
}

export interface FederatedAuthRecovery {
  version: 1;
  flowId: string;
  attemptId: string;
  pollSecret: string;
  authorizationUrl: string;
  completionUri: string;
  loopbackNonce: string;
  expiresAt: string;
  completionProof?: string;
  registration?: RegistrationRecovery;
}

export interface FederatedAuthRecoveryStore {
  load(environment: Environment): Promise<FederatedAuthRecovery | undefined>;
  save(environment: Environment, recovery: FederatedAuthRecovery): Promise<void>;
  clear(environment: Environment): Promise<void>;
}

export class MemoryFederatedAuthRecoveryStore implements FederatedAuthRecoveryStore {
  private readonly values = new Map<Environment, FederatedAuthRecovery>();
  async load(environment: Environment) {
    const value = this.values.get(environment);
    return value && structuredClone(value);
  }
  async save(environment: Environment, recovery: FederatedAuthRecovery) {
    validateRecovery(recovery);
    this.values.set(environment, structuredClone(recovery));
  }
  async clear(environment: Environment) { this.values.delete(environment); }
}

export class KeyringFederatedAuthRecoveryStore implements FederatedAuthRecoveryStore {
  constructor(private readonly createEntry: NativeCredentialEntryFactory) {}
  async load(environment: Environment): Promise<FederatedAuthRecovery | undefined> {
    const value = await this.entry(environment).getPassword();
    if (value == null) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch (error) { throw new Error('Invalid federated auth recovery', { cause: error }); }
    validateRecovery(parsed);
    return parsed;
  }
  async save(environment: Environment, recovery: FederatedAuthRecovery) {
    validateRecovery(recovery);
    await this.entry(environment).setPassword(JSON.stringify(recovery));
  }
  async clear(environment: Environment) { await this.entry(environment).deletePassword(); }
  private entry(environment: Environment) { return this.createEntry(`ai.taskpilot.desktop.federated-auth.${environment}`, 'current-flow'); }
}

function validateRecovery(value: unknown): asserts value is FederatedAuthRecovery {
  const item = recordWithKeys(value, [
    'version', 'flowId', 'attemptId', 'pollSecret', 'authorizationUrl', 'completionUri',
    'loopbackNonce', 'expiresAt', 'completionProof', 'registration',
  ]);
  if (item.version !== 1
    || !boundedString(item.flowId, 1, 128)
    || !boundedString(item.attemptId, 1, 128)
    || !secret(item.pollSecret)
    || !boundedString(item.authorizationUrl, 1, 2_048)
    || !boundedString(item.completionUri, 1, 512)
    || !nonce(item.loopbackNonce)
    || !timestamp(item.expiresAt)
    || (item.completionProof !== undefined && !secret(item.completionProof))) {
    throw new Error('Invalid federated auth recovery');
  }
  if (!safeAuthorizationUrl(item.authorizationUrl) || !safeCompletionUri(item.completionUri, item.loopbackNonce)) {
    throw new Error('Invalid federated auth recovery');
  }
  if (item.registration !== undefined) validateRegistration(item.registration);
}

function validateRegistration(value: unknown): asserts value is RegistrationRecovery {
  const item = recordWithKeys(value, [
    'continuationId', 'continuationSecret', 'suggestedDisplayName', 'suggestedAvatarUrl', 'legalBundleVersion', 'termsVersion', 'privacyVersion', 'legalLocales', 'expiresAt',
  ]);
  if (!boundedString(item.continuationId, 1, 128)
    || !secret(item.continuationSecret)
    || !boundedString(item.suggestedDisplayName, 1, 120)
    || !boundedString(item.legalBundleVersion, 1, 128)
    || !boundedString(item.termsVersion, 1, 128)
    || !boundedString(item.privacyVersion, 1, 128)
    || !legalLocales(item.legalLocales)
    || !timestamp(item.expiresAt)
    || (item.suggestedAvatarUrl !== undefined && !safeAvatarUrl(item.suggestedAvatarUrl))) {
    throw new Error('Invalid federated auth recovery');
  }
}

function recordWithKeys(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid federated auth recovery');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !allowedKeys.includes(key))) throw new Error('Invalid federated auth recovery');
  return item;
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function legalLocales(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 32
    && value.every(locale => boundedString(locale, 1, 35))
    && new Set(value).size === value.length;
}

function secret(value: unknown): value is string {
  return boundedString(value, 16, 16_384) && /^[A-Za-z0-9._~-]+$/.test(value);
}

function nonce(value: unknown): value is string {
  return boundedString(value, 32, 128) && /^[A-Za-z0-9_-]+$/.test(value);
}

function timestamp(value: unknown): value is string {
  return boundedString(value, 1, 128) && Number.isFinite(Date.parse(value));
}

function safeAvatarUrl(value: unknown): value is string {
  if (!boundedString(value, 1, 2_048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === '';
  } catch { return false; }
}

export function safeAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.port === ''
      && url.username === '' && url.password === '' && url.pathname === '/login/oauth/authorize' && url.hash === '';
  } catch { return false; }
}

export function safeCompletionUri(value: string, expectedNonce?: string): boolean {
  try {
    const url = new URL(value);
    const port = Number(url.port);
    const match = /^\/taskpilot\/oauth\/complete\/([A-Za-z0-9_-]{32,128})$/.exec(url.pathname);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number.isInteger(port)
      && port >= 49_152 && port <= 65_535 && url.username === '' && url.password === ''
      && url.search === '' && url.hash === '' && match !== null && (expectedNonce === undefined || match[1] === expectedNonce);
  } catch { return false; }
}
