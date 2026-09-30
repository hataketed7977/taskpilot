import { randomUUID } from 'node:crypto';
import type { CurrentUserView, IssuedSession, SessionView } from '../../shared/contracts.js';
import type { Environment } from '../api/transport.js';
import type { CredentialStore, StoredCredential } from '../credentials/credential-store.js';

interface SessionPort { refresh(refreshToken: string, refreshRequestId: string): Promise<IssuedSession>; logout(accessToken: string): Promise<void> }
interface SessionLifecycle { clearProtectedState(userId: string): Promise<void> }
export class CredentialStorageError extends Error {
  readonly code = 'CREDENTIAL_STORAGE_UNAVAILABLE';
  readonly category = 'temporary';
  readonly recovery = 'RETRY';
  constructor(options?: ErrorOptions) { super('OS credential facility unavailable', options); }
}
export class SessionCoordinator {
  private accessToken?: string; private currentUser?: CurrentUserView; private generation = 0;
  private refreshing?: Promise<void>; private credentialMutation: Promise<void> = Promise.resolve();
  private state: SessionView = { status: 'signedOut' };
  private listeners = new Set<(view: SessionView) => void>();
  constructor(private readonly environment: Environment, private readonly credentials: CredentialStore, private readonly port: SessionPort, private readonly requestId: () => string = randomUUID, private readonly lifecycle?: SessionLifecycle) {}
  view(): SessionView { return this.state; }
  subscribe(listener: (view: SessionView) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async establish(session: IssuedSession): Promise<void> {
    const credential = this.toCredential(session);
    try { await this.mutateCredential(() => this.credentials.saveCurrent(this.environment, credential)); }
    catch { this.accessToken = undefined; this.currentUser = undefined; await Promise.resolve(this.port.logout(session.accessToken)).catch(() => undefined); this.publish({ status: 'signedOut' }); throw new CredentialStorageError(); }
    this.accessToken = session.accessToken; this.currentUser = session.currentUser; this.publish({ status: 'authenticated', currentUser: session.currentUser });
  }
  async restore(): Promise<void> {
    this.publish({ status: 'restoring' });
    let stored: StoredCredential | undefined;
    try {
      stored = await this.credentials.loadCurrent(this.environment);
    } catch (error) {
      this.accessToken = undefined; this.currentUser = undefined;
      this.publish({ status: 'temporarilyUnavailable' });
      throw new CredentialStorageError({ cause: error });
    }
    if (!stored) { this.publish({ status: 'signedOut' }); return; }
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
    const token = this.accessToken; if (!token) throw new Error('AUTHENTICATION_REQUIRED');
    try { return await operation(token); } catch (error) {
      if ((error as { status?: number }).status !== 401) throw error;
      await this.refresh();
      if (!this.accessToken) throw new Error('AUTHENTICATION_REQUIRED', { cause: error });
      return operation(this.accessToken);
    }
  }
  async logout(): Promise<void> {
    const oldToken = this.accessToken; const oldUserId = this.currentUser?.userId;
    this.generation += 1; this.accessToken = undefined; this.currentUser = undefined;
    let credentialError: unknown;
    try { await this.mutateCredential(() => this.credentials.clearCurrent(this.environment)); } catch (error) { credentialError = error; }
    if (oldUserId) await this.lifecycle?.clearProtectedState(oldUserId).catch(() => undefined);
    this.publish({ status: 'signedOut' });
    if (oldToken) await Promise.resolve(this.port.logout(oldToken)).catch(() => undefined);
    if (credentialError) throw new CredentialStorageError({ cause: credentialError });
  }
  private async rotate(stored: StoredCredential, generation = this.generation): Promise<void> {
    if (generation !== this.generation) return;
    const pendingRefreshRequestId = stored.pendingRefreshRequestId ?? this.requestId();
    const pending = { ...stored, pendingRefreshRequestId };
    try {
      const pendingSaved = await this.mutateCredential(async () => {
        if (generation !== this.generation) return false;
        await this.credentials.saveCurrent(this.environment, pending);
        return true;
      });
      if (!pendingSaved) return;
      const session = await this.port.refresh(stored.refreshToken, pendingRefreshRequestId);
      if (generation !== this.generation) { await this.revokeLateSession(session); return; }
      const rotatedSaved = await this.mutateCredential(async () => {
        if (generation !== this.generation) return false;
        await this.credentials.saveCurrent(this.environment, this.toCredential(session));
        return true;
      });
      if (!rotatedSaved || generation !== this.generation) { await this.revokeLateSession(session); return; }
      this.accessToken = session.accessToken; this.currentUser = session.currentUser;
      this.publish({ status: 'authenticated', currentUser: session.currentUser });
    } catch (error) {
      if (generation === this.generation) {
        this.accessToken = undefined; this.currentUser = undefined;
        if ((error as { status?: number }).status === 401) {
          this.generation += 1;
          let credentialError: unknown;
          try { await this.mutateCredential(() => this.credentials.clearCurrent(this.environment)); } catch (failure) { credentialError = failure; }
          await this.lifecycle?.clearProtectedState(stored.userId).catch(() => undefined);
          this.publish({ status: 'signedOut' });
          if (credentialError) throw new CredentialStorageError({ cause: credentialError });
        } else {
          this.publish({ status: 'temporarilyUnavailable' });
        }
      }
      throw error;
    }
  }
  private async revokeLateSession(session: IssuedSession): Promise<void> {
    await Promise.resolve(this.port.logout(session.accessToken)).catch(() => undefined);
  }
  private mutateCredential<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.credentialMutation.then(operation);
    this.credentialMutation = result.then(() => undefined, () => undefined);
    return result;
  }
  private toCredential(session: IssuedSession): StoredCredential { return { userId: session.currentUser.userId, refreshToken: session.refreshToken, refreshTokenExpiresAt: session.refreshTokenExpiresAt }; }
  private publish(view: SessionView) { this.state = view; for (const listener of this.listeners) listener(view); }
}
