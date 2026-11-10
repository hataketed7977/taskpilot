import type { CurrentUserView, IssuedSession, SessionView } from '../../shared/contracts.js';
import type { Environment } from '../api/transport.js';
import type { CredentialStore, StoredCredential } from '../credentials/credential-store.js';

export interface SessionContext { generation: number; user: CurrentUserView }

interface SessionPort {
  refresh(refreshToken: string): Promise<IssuedSession>;
  logout(refreshToken: string | undefined, legacyAccessToken?: string): Promise<void>;
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
  private restoring?: { generation: number; promise: Promise<void> };
  private credentialMutation: Promise<void> = Promise.resolve();
  private state: SessionView = { status: 'signedOut' };
  private readonly listeners = new Set<(view: SessionView) => void>();

  constructor(
    private readonly environment: Environment,
    private readonly credentials: CredentialStore,
    private readonly port: SessionPort,
  ) {}

  view(): SessionView { return this.state; }
  context(): SessionContext {
    if (!this.currentUser || !this.accessToken) throw authenticationRequired();
    return { generation: this.generation, user: this.currentUser };
  }
  subscribe(listener: (view: SessionView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async establish(session: IssuedSession): Promise<void> {
    const generation = ++this.generation;
    let cleanupFailed = false;
    try {
      await this.mutateCredential(async () => {
        if (generation !== this.generation) throw contextSuperseded();
        try { await this.credentials.saveCurrent(this.environment, this.toCredential(session)); }
        catch (error) {
          try { await this.credentials.clearCurrent(this.environment); }
          catch { cleanupFailed = true; }
          throw error;
        }
      });
    } catch (error) {
      await this.revokeIssued(session);
      if (generation !== this.generation || isSessionContextSuperseded(error)) throw contextSuperseded();
      this.accessToken = undefined;
      this.currentUser = undefined;
      this.publish({ status: cleanupFailed ? 'temporarilyUnavailable' : 'signedOut' });
      throw new CredentialStorageError({ cause: error });
    }
    if (generation !== this.generation) {
      await this.revokeIssued(session);
      throw contextSuperseded();
    }
    this.accessToken = session.accessToken;
    this.currentUser = session.currentUser;
    this.publish({ status: 'authenticated', currentUser: session.currentUser });
  }

  async revokeIssued(session: IssuedSession): Promise<void> {
    await Promise.resolve().then(() => this.port.logout(session.refreshToken)).catch(() => undefined);
  }

  /** Capture startup intent before waiting for federated recovery. */
  recoveryGeneration(): number { return this.generation; }

  restore(generation = this.generation): Promise<void> {
    if (generation !== this.generation) return Promise.resolve();
    return this.recover(generation, true);
  }

  refresh(): Promise<void> { return this.recover(this.generation, false); }

  async retrySessionRestore(): Promise<SessionView> {
    if (this.state.status === 'authenticated' || this.state.status === 'signedOut') return this.view();
    await this.restore();
    return this.view();
  }

  private recover(generation: number, showRestoring: boolean): Promise<void> {
    if (this.restoring?.generation === generation) return this.restoring.promise;
    // Register the complete flight before publication can synchronously trigger another caller.
    const flight = { generation, promise: Promise.resolve() };
    this.restoring = flight;
    flight.promise = Promise.resolve().then(async () => {
      if (generation !== this.generation) return;
      if (showRestoring) this.publish({ status: 'restoring' });
      let stored: StoredCredential | undefined;
      try {
        stored = await this.credentials.loadCurrent(this.environment);
      } catch (error) {
        if (generation !== this.generation) return;
        this.accessToken = undefined;
        this.currentUser = undefined;
        this.publish({ status: 'temporarilyUnavailable' });
        throw new CredentialStorageError({ cause: error });
      }
      if (generation !== this.generation) return;
      if (!stored) {
        this.accessToken = undefined;
        this.currentUser = undefined;
        this.publish({ status: 'signedOut' });
        if (!showRestoring) throw authenticationRequired();
        return;
      }
      await this.rotate(stored, generation);
    }).finally(() => {
      if (this.restoring === flight) this.restoring = undefined;
    });
    return flight.promise;
  }

  async protected<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
    const context = this.context();
    const token = this.accessToken!;
    try {
      const value = await operation(token);
      this.assertCurrent(context);
      return value;
    } catch (error) {
      if ((error as { status?: number }).status !== 401) throw error;
      this.assertCurrent(context);
      await this.refresh();
      this.assertCurrent(context);
      if (!this.accessToken) throw authenticationRequired(error);
      const value = await operation(this.accessToken);
      this.assertCurrent(context);
      return value;
    }
  }

  assertCurrent(context: SessionContext): void {
    if (context.generation !== this.generation || context.user.userId !== this.currentUser?.userId || !this.accessToken) {
      throw contextSuperseded();
    }
  }

  async logout(): Promise<void> {
    const oldToken = this.accessToken;
    this.generation += 1;
    this.accessToken = undefined;
    this.currentUser = undefined;
    let refreshToken: string | undefined;
    let credentialError: unknown;
    // Register read + cleanup synchronously, before an observer may establish a new account.
    // Never generation-skip this old-slot cleanup; the queue keeps it before every newer save.
    const cleanup = this.mutateCredential(async () => {
      try {
        refreshToken = (await this.credentials.loadCurrent(this.environment))?.refreshToken;
      } catch (error) {
        credentialError = error;
      }
      try {
        await this.credentials.clearCurrent(this.environment);
      } catch (error) {
        credentialError ??= error;
      }
    });
    this.publish({ status: 'signedOut' });
    await cleanup;
    if (refreshToken || oldToken) {
      await Promise.resolve().then(() => refreshToken ? this.port.logout(refreshToken) : this.port.logout(undefined, oldToken))
        .catch(() => undefined);
    }
    if (credentialError) throw new CredentialStorageError({ cause: credentialError });
  }

  private async rotate(stored: StoredCredential, generation: number): Promise<void> {
    let issued: IssuedSession | undefined;
    let cleanupFailed = false;
    try {
      issued = await this.port.refresh(stored.refreshToken);
      const session = issued;
      if (generation !== this.generation) {
        await this.revokeIssued(session);
        return;
      }
      const saved = await this.mutateCredential(async () => {
        if (generation !== this.generation) return false;
        try {
          await this.credentials.saveCurrent(this.environment, this.toCredential(session));
        } catch (error) {
          // Cleanup belongs to this queue slot, not behind a newer account's save.
          try { await this.credentials.clearCurrent(this.environment); }
          catch { cleanupFailed = true; }
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
      if (issued) await this.revokeIssued(issued);
      if (generation !== this.generation) return;
      this.accessToken = undefined;
      this.currentUser = undefined;
      if (error instanceof CredentialStorageError) {
        this.publish({ status: cleanupFailed ? 'temporarilyUnavailable' : 'signedOut' });
      } else if ((error as { status?: number }).status === 401) {
        const cleanup = this.mutateCredential(() => this.credentials.clearCurrent(this.environment));
        try { await cleanup; }
        catch (failure) {
          if (generation !== this.generation) return;
          this.publish({ status: 'temporarilyUnavailable' });
          throw new CredentialStorageError({ cause: failure });
        }
        if (generation !== this.generation) return;
        this.publish({ status: 'signedOut' });
      } else {
        this.publish({ status: 'temporarilyUnavailable' });
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


function authenticationRequired(cause?: unknown): Error {
  return Object.assign(new Error('Authentication required', cause === undefined ? undefined : { cause }), {
    code: 'AUTHENTICATION_REQUIRED', category: 'authentication', recovery: 'SIGN_IN',
  });
}

function contextSuperseded(): Error {
  return Object.assign(new Error('Session context superseded'), {
    code: 'SESSION_CONTEXT_SUPERSEDED', category: 'authentication', recovery: 'SIGN_IN',
  });
}

function isSessionContextSuperseded(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'SESSION_CONTEXT_SUPERSEDED';
}
