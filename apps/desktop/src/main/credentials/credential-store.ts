import type { Environment } from '../api/transport.js';

export interface StoredCredential {
  userId: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  pendingRefreshRequestId?: string;
}

export interface CredentialStore {
  loadCurrent(environment: Environment): Promise<StoredCredential | undefined>;
  saveCurrent(environment: Environment, credential: StoredCredential): Promise<void>;
  clearCurrent(environment: Environment): Promise<void>;
}

export class MemoryCredentialStore implements CredentialStore {
  failWrites = false;
  failDeletes = false;
  private readonly current = new Map<Environment, string>();
  private readonly values = new Map<string, StoredCredential>();

  async loadCurrent(environment: Environment) {
    const userId = this.current.get(environment);
    return userId ? structuredClone(this.values.get(this.key(environment, userId))) : undefined;
  }

  async saveCurrent(environment: Environment, credential: StoredCredential) {
    if (this.failWrites) throw new Error('credential write failed');
    this.values.set(this.key(environment, credential.userId), structuredClone(credential));
    this.current.set(environment, credential.userId);
  }

  async clearCurrent(environment: Environment) {
    if (this.failDeletes) throw new Error('credential delete failed');
    const userId = this.current.get(environment);
    if (userId) this.values.delete(this.key(environment, userId));
    this.current.delete(environment);
  }

  private key(environment: Environment, userId: string) {
    return `${environment}:${userId}`;
  }
}

export interface NativeCredentialEntry {
  getPassword(): Promise<string | null | undefined>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

export type NativeCredentialEntryFactory = (service: string, account: string) => NativeCredentialEntry;

interface StoredCredentialEnvelope extends StoredCredential {
  version: 1;
}

const SERVICE_PREFIX = 'ai.taskpilot.desktop.session';
const CURRENT_ACCOUNT = 'current-account';
const ACCOUNT_PREFIX = 'account:';
const SIGNED_OUT_PREFIX = 'signed-out:';
const USER_ID = /^[A-Za-z0-9-]{1,128}$/;

interface CurrentAccountState {
  userId: string;
  signedOut: boolean;
}

/**
 * Persists session recovery material directly in the platform credential store.
 * Both the refresh token and an optional pending refresh request id are encoded
 * in one value so a platform set-password operation replaces them atomically.
 */
export class KeyringCredentialStore implements CredentialStore {
  constructor(private readonly createEntry: NativeCredentialEntryFactory) {}

  async loadCurrent(environment: Environment): Promise<StoredCredential | undefined> {
    const service = this.service(environment);
    const pointerValue = await this.createEntry(service, CURRENT_ACCOUNT).getPassword();
    if (pointerValue == null) return undefined;
    const pointer = this.parsePointer(pointerValue);
    if (pointer.signedOut) return undefined;

    const value = await this.createEntry(service, this.account(pointer.userId)).getPassword();
    if (value == null) return undefined;
    return this.parseCredential(value, pointer.userId);
  }

  async saveCurrent(environment: Environment, credential: StoredCredential): Promise<void> {
    this.validateCredential(credential);
    const service = this.service(environment);
    const pointer = this.createEntry(service, CURRENT_ACCOUNT);
    const account = this.createEntry(service, this.account(credential.userId));
    const pointerValue = await pointer.getPassword();
    const current = pointerValue == null ? undefined : this.parsePointer(pointerValue);
    if (current?.signedOut) {
      await this.createEntry(service, this.account(current.userId)).deletePassword();
    }
    const currentUserId = current?.signedOut ? undefined : current?.userId;

    const serialized = JSON.stringify({ version: 1, ...credential } satisfies StoredCredentialEnvelope);
    if (currentUserId === credential.userId) {
      await account.setPassword(serialized);
      return;
    }

    const previousValue = await account.getPassword();
    await account.setPassword(serialized);
    try {
      await pointer.setPassword(credential.userId);
    } catch (pointerError) {
      try {
        if (previousValue == null) await account.deletePassword();
        else await account.setPassword(previousValue);
      } catch (rollbackError) {
        throw new AggregateError(
          [pointerError, rollbackError],
          'OS credential pointer update and rollback failed',
          { cause: rollbackError },
        );
      }
      throw pointerError;
    }
  }

  async clearCurrent(environment: Environment): Promise<void> {
    const service = this.service(environment);
    const pointer = this.createEntry(service, CURRENT_ACCOUNT);
    const pointerValue = await pointer.getPassword();
    if (pointerValue == null) return;
    const current = this.parsePointer(pointerValue);
    if (!current.signedOut) await pointer.setPassword(this.signedOutPointer(current.userId));
    await this.createEntry(service, this.account(current.userId)).deletePassword();
    await pointer.deletePassword();
  }

  private parsePointer(value: string): CurrentAccountState {
    const signedOut = value.startsWith(SIGNED_OUT_PREFIX);
    const userId = signedOut ? value.slice(SIGNED_OUT_PREFIX.length) : value;
    this.validateUserId(userId);
    return { userId, signedOut };
  }

  private signedOutPointer(userId: string) {
    return `${SIGNED_OUT_PREFIX}${userId}`;
  }

  private parseCredential(value: string, expectedUserId: string): StoredCredential {
    let candidate: unknown;
    try {
      candidate = JSON.parse(value);
    } catch (error) {
      throw new Error('Invalid OS credential', { cause: error });
    }
    if (!this.isCredentialEnvelope(candidate) || candidate.userId !== expectedUserId) {
      throw new Error('Invalid OS credential');
    }
    return {
      userId: candidate.userId,
      refreshToken: candidate.refreshToken,
      refreshTokenExpiresAt: candidate.refreshTokenExpiresAt,
      ...(candidate.pendingRefreshRequestId === undefined
        ? {}
        : { pendingRefreshRequestId: candidate.pendingRefreshRequestId }),
    };
  }

  private isCredentialEnvelope(value: unknown): value is StoredCredentialEnvelope {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate);
    return candidate.version === 1
      && keys.every(key => ['version', 'userId', 'refreshToken', 'refreshTokenExpiresAt', 'pendingRefreshRequestId'].includes(key))
      && typeof candidate.userId === 'string'
      && USER_ID.test(candidate.userId)
      && typeof candidate.refreshToken === 'string'
      && candidate.refreshToken.length > 0
      && typeof candidate.refreshTokenExpiresAt === 'string'
      && candidate.refreshTokenExpiresAt.length > 0
      && (candidate.pendingRefreshRequestId === undefined
        || (typeof candidate.pendingRefreshRequestId === 'string' && candidate.pendingRefreshRequestId.length > 0));
  }

  private validateCredential(credential: StoredCredential) {
    if (!this.isCredentialEnvelope({ version: 1, ...credential })) throw new Error('Invalid OS credential');
  }

  private validateUserId(userId: string) {
    if (!USER_ID.test(userId)) throw new Error('Invalid OS credential account');
  }

  private service(environment: Environment) {
    return `${SERVICE_PREFIX}.${environment}`;
  }

  private account(userId: string) {
    return `${ACCOUNT_PREFIX}${userId}`;
  }
}
