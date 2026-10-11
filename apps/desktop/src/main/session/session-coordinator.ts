import type { CurrentUserView, IssuedSession, SessionView } from '../../shared/contracts.js';
import type { Environment } from '../api/transport.js';
import type { CredentialStore, StoredCredential } from '../credentials/credential-store.js';

interface SessionPort {
  refresh(refreshToken: string): Promise<IssuedSession>;
  logout(accessToken: string): Promise<void>;
}

export class CredentialStorageError extends Error {
  readonly code = 'CREDENTIAL_STORAGE_UNAVAILABLE';
  readonly category = 'temporary';
  readonly recovery = 'RETRY';
  constructor(options?: ErrorOptions) { super('OS credential facility unavailable', options); }
}

export class SessionCoordinator {
  private accessToken?: string;
  private currentUser?: CurrentUserView;
  private generation = 0;
  private refreshing?: Promise<void>;
  private credentialMutation: Promise<void> = Promise.resolve();
  private state: SessionView = { status: 'signedOut' };
  private readonly listeners = new Set<(view: SessionView) => void>();

  constructor(
    private readonly environment: Environment,
    private readonly credentials: CredentialStore,
    private readonly port: SessionPort,
  ) {}

  view(): SessionView { return this.state; }
  subscribe(listener: (view: SessionView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async establish(session: IssuedSession): Promise<void> {
    try {
      await this.mutateCredential(() => this.credentials.saveCurrent(this.environment, this.toCredential(session)));
    } catch (error) {
      this.accessToken = undefined;
      this.currentUser = undefined;
      await this.revokeIssued(session);
      this.publish({ status: 'signedOut' });
      throw new CredentialStorageError({ cause: error });
    }
    this.accessToken = session.accessToken;
    this.currentUser = session.currentUser;
    this.publish({ status: 'authenticated', currentUser: session.currentUser });
  }

  async revokeIssued(session: IssuedSession): Promise<void> {
    await Promise.resolve(this.port.logout(session.accessToken)).catch(() => undefined);
  }

  async restore(): Promise<void> {
    this.publish({ status: 'restoring' });
    let stored: StoredCredential | undefined;
    try {
      stored = await this.credentials.loadCurrent(this.environment);
    } catch (error) {
      this.accessToken = undefined;
      this.currentUser = undefined;
      this.publish({ status: 'temporarilyUnavailable' });
      throw new CredentialStorageError({ cause: error });
    }
    if (!stored) {
      this.publish({ status: 'signedOut' });
      return;
    }
    await this.rotate(stored);
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = (async () => {
      const stored = await this.credentials.loadCurrent(this.environment);
      if (!stored) throw new Error('AUTHENTICATION_REQUIRED');
      await this.rotate(stored, generation);
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  async protected<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
    const token = this.accessToken;
    if (!token) throw new Error('AUTHENTICATION_REQUIRED');
    try {
      return await operation(token);
    } catch (error) {
      if ((error as { status?: number }).status !== 401) throw error;
      await this.refresh();
      if (!this.accessToken) throw new Error('AUTHENTICATION_REQUIRED', { cause: error });
      return operation(this.accessToken);
    }
  }

  async logout(): Promise<void> {
    const oldToken = this.accessToken;
    this.generation += 1;
    this.accessToken = undefined;
    this.currentUser = undefined;
    let credentialError: unknown;
    try {
      await this.mutateCredential(() => this.credentials.clearCurrent(this.environment));
    } catch (error) {
      credentialError = error;
    }
    this.publish({ status: 'signedOut' });
    if (oldToken) await Promise.resolve(this.port.logout(oldToken)).catch(() => undefined);
    if (credentialError) throw new CredentialStorageError({ cause: credentialError });
  }

  private async rotate(stored: StoredCredential, generation = this.generation): Promise<void> {
    if (generation !== this.generation) return;
    try {
      const session = await this.port.refresh(stored.refreshToken);
      if (generation !== this.generation) {
        await this.revokeIssued(session);
        return;
      }
      const saved = await this.mutateCredential(async () => {
        if (generation !== this.generation) return false;
        try {
          await this.credentials.saveCurrent(this.environment, this.toCredential(session));
        } catch (error) {
          await this.revokeIssued(session);
          throw new CredentialStorageError({ cause: error });
        }
        return true;
      });
      if (!saved || generation !== this.generation) {
        await this.revokeIssued(session);
        return;
      }
      this.accessToken = session.accessToken;
      this.currentUser = session.currentUser;
      this.publish({ status: 'authenticated', currentUser: session.currentUser });
    } catch (error) {
      if (generation === this.generation) {
        this.accessToken = undefined;
        this.currentUser = undefined;
        if (error instanceof CredentialStorageError) {
          this.generation += 1;
          try {
            await this.mutateCredential(() => this.credentials.clearCurrent(this.environment));
          } catch {
            this.publish({ status: 'temporarilyUnavailable' });
            throw error;
          }
          this.publish({ status: 'signedOut' });
        } else if ((error as { status?: number }).status === 401 || isAmbiguousNetworkFailure(error)) {
          this.generation += 1;
          try {
            await this.mutateCredential(() => this.credentials.clearCurrent(this.environment));
          } catch (failure) {
            this.publish({ status: 'temporarilyUnavailable' });
            throw new CredentialStorageError({ cause: failure });
          }
          this.publish({ status: 'signedOut' });
        } else {
          this.publish({ status: 'temporarilyUnavailable' });
        }
      }
      throw error;
    }
  }

  private mutateCredential<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.credentialMutation.then(operation);
    this.credentialMutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private toCredential(session: IssuedSession): StoredCredential {
    return {
      userId: session.currentUser.userId,
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    };
  }

  private publish(view: SessionView) {
    this.state = view;
    for (const listener of this.listeners) listener(view);
  }
}

function isAmbiguousNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError');
}
