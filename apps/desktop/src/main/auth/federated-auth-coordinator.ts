import { randomUUID } from 'node:crypto';
import type { FederatedAuthFlowView, IssuedSession } from '../../shared/contracts.js';
import type { Environment } from '../api/transport.js';
import type { SessionCoordinator } from '../session/session-coordinator.js';
import type { FederatedAuthClient, FederatedPollResponse } from './auth-client.js';
import type { FederatedAuthRecovery, FederatedAuthRecoveryStore } from './auth-recovery-store.js';
import { safeAuthorizationUrl, safeCompletionUri } from './auth-recovery-store.js';
import { LoopbackReceiver, type LoopbackHandle } from './loopback-receiver.js';

export interface ExternalBrowser { open(url: string): Promise<void> }
export type DesktopWindowActivator = () => void | Promise<void>;
export type FederatedAuthRestoreResult = 'attempt' | 'none';

export class FederatedAuthCoordinator {
  private receiver?: LoopbackHandle;
  private operation?: Promise<FederatedAuthFlowView>;
  private generation = 0;

  constructor(
    private readonly environment: Environment,
    private readonly installationId: string,
    private readonly client: FederatedAuthClient,
    private readonly recoveryStore: FederatedAuthRecoveryStore,
    private readonly session: SessionCoordinator,
    private readonly browser: ExternalBrowser,
    private readonly loopback = new LoopbackReceiver(),
    private readonly createId: () => string = randomUUID,
    private readonly now: () => number = Date.now,
    private readonly activateDesktop: DesktopWindowActivator = () => undefined,
  ) {}

  capabilities() { return this.client.capabilities(); }

  async start(): Promise<FederatedAuthFlowView> {
    if (this.operation) return this.operation;
    const generation = ++this.generation;
    this.operation = this.startOwned(generation).finally(() => {
      if (generation === this.generation) this.operation = undefined;
    });
    return this.operation;
  }

  async continue(flowId: string): Promise<FederatedAuthFlowView> {
    const generation = this.generation;
    const recovery = await this.requireRecovery(flowId);
    if (this.isExpired(recovery)) return this.finish(recovery, 'expired');
    try {
      return await this.poll(recovery, generation);
    } catch (error) {
      await this.cleanupRejectedRecovery(error);
      throw error;
    }
  }

  async register(input: {
    flowId: string;
    displayName: string;
    useSuggestedAvatar: boolean;
    legalBundleVersion: string;
    termsVersion: string;
    privacyVersion: string;
    locale: string;
  }): Promise<FederatedAuthFlowView> {
    const generation = this.generation;
    const recovery = await this.requireRecovery(input.flowId);
    if (this.isExpired(recovery)) return this.finish(recovery, 'expired');
    const registration = recovery.registration;
    if (!registration) throw contextInvalid('Registration context unavailable');
    const response = await this.client.register({
      continuationId: registration.continuationId,
      continuationSecret: registration.continuationSecret,
      displayName: input.displayName,
      useSuggestedAvatar: input.useSuggestedAvatar,
      legalBundleVersion: input.legalBundleVersion,
      termsVersion: input.termsVersion,
      privacyVersion: input.privacyVersion,
      locale: input.locale,
    });
    return this.mapResponse(recovery, response, generation);
  }

  async cancel(flowId: string): Promise<void> {
    const recovery = await this.requireRecovery(flowId);
    ++this.generation;
    this.operation = undefined;
    await this.cancelRecovery(recovery);
  }

  async restore(): Promise<FederatedAuthRestoreResult> {
    const recovery = await this.recoveryStore.load(this.environment);
    if (!recovery) return 'none';
    const generation = ++this.generation;
    if (this.isExpired(recovery)) {
      await this.client.cancel(recovery.attemptId, recovery.pollSecret).catch(() => undefined);
      await this.cleanup();
      return 'none';
    }
    if (!recovery.completionProof) await this.bindRecoveredReceiver(recovery, generation);
    return 'attempt';
  }

  async close(): Promise<void> {
    ++this.generation;
    this.operation = undefined;
    const recovery = await this.recoveryStore.load(this.environment).catch(() => undefined);
    if (recovery) await this.client.cancel(recovery.attemptId, recovery.pollSecret).catch(() => undefined);
    await this.cleanup();
  }

  private async startOwned(generation: number): Promise<FederatedAuthFlowView> {
    const existing = await this.recoveryStore.load(this.environment);
    if (existing && !this.isExpired(existing)) {
      if (!existing.completionProof && !this.receiver) await this.bindRecoveredReceiver(existing, generation);
      try {
        return await this.poll(existing, generation);
      } catch (error) {
        if (!await this.cleanupRejectedRecovery(error)) throw error;
      }
    } else if (existing) {
      await this.cancelRecovery(existing, false);
    }

    const receiver = await this.loopback.start();
    if (generation !== this.generation) {
      await receiver.close().catch(() => undefined);
      throw superseded();
    }
    this.receiver = receiver;
    let recovery: FederatedAuthRecovery | undefined;
    try {
      const attempt = await this.client.createAttempt({
        installationId: this.installationId,
        completionUri: receiver.completionUri,
      });
      if (generation !== this.generation) throw superseded();
      if (!safeAuthorizationUrl(attempt.authorizationUrl)
        || !safeCompletionUri(receiver.completionUri, receiver.nonce)
        || !Number.isFinite(Date.parse(attempt.expiresAt))) {
        await this.client.cancel(attempt.attemptId, attempt.pollSecret).catch(() => undefined);
        throw new Error('Unsafe federated authorization contract');
      }
      recovery = {
        version: 1,
        flowId: this.createId(),
        attemptId: attempt.attemptId,
        pollSecret: attempt.pollSecret,
        authorizationUrl: attempt.authorizationUrl,
        completionUri: receiver.completionUri,
        loopbackNonce: receiver.nonce,
        expiresAt: attempt.expiresAt,
      };
      await this.recoveryStore.save(this.environment, recovery);
      this.observeProof(receiver, recovery, generation);
      await this.browser.open(attempt.authorizationUrl);
      if (generation !== this.generation) throw superseded();
      return this.safeView(recovery);
    } catch (error) {
      if (recovery) await this.client.cancel(recovery.attemptId, recovery.pollSecret).catch(() => undefined);
      await receiver.close().catch(() => undefined);
      if (this.receiver === receiver) this.receiver = undefined;
      if (recovery) await this.recoveryStore.clear(this.environment).catch(() => undefined);
      throw error;
    }
  }

  private async bindRecoveredReceiver(recovery: FederatedAuthRecovery, generation: number): Promise<void> {
    const port = new URL(recovery.completionUri).port;
    const receiver = await this.loopback.start({ port: Number(port), nonce: recovery.loopbackNonce });
    if (generation !== this.generation || receiver.completionUri !== recovery.completionUri) {
      await receiver.close().catch(() => undefined);
      throw superseded();
    }
    await this.receiver?.close().catch(() => undefined);
    this.receiver = receiver;
    this.observeProof(receiver, recovery, generation);
  }

  private observeProof(receiver: LoopbackHandle, recovery: FederatedAuthRecovery, generation: number) {
    void receiver.proof.then(async completionProof => {
      if (generation !== this.generation) return;
      const current = await this.recoveryStore.load(this.environment);
      if (current?.flowId === recovery.flowId) {
        await this.recoveryStore.save(this.environment, { ...current, completionProof });
        if (generation === this.generation) await Promise.resolve(this.activateDesktop()).catch(() => undefined);
      }
      if (this.receiver === receiver) this.receiver = undefined;
    }).catch(() => {
      if (this.receiver === receiver) this.receiver = undefined;
    });
  }

  private async poll(recovery: FederatedAuthRecovery, generation: number): Promise<FederatedAuthFlowView> {
    const current = await this.recoveryStore.load(this.environment) ?? recovery;
    const response = await this.client.poll(current.attemptId, {
      pollSecret: current.pollSecret,
      ...(current.completionProof ? { completionProof: current.completionProof } : {}),
    });
    return this.mapResponse(current, response, generation);
  }

  private async mapResponse(
    recovery: FederatedAuthRecovery,
    response: FederatedPollResponse,
    generation: number,
  ): Promise<FederatedAuthFlowView> {
    if (generation !== this.generation) {
      if (response.session) await this.session.revokeIssued(response.session);
      throw superseded();
    }
    switch (response.status) {
      case 'WAITING': return { status: 'waiting', flowId: recovery.flowId, expiresAt: recovery.expiresAt };
      case 'COMPLETION_REQUIRED': return { status: 'completionRequired', flowId: recovery.flowId, expiresAt: recovery.expiresAt };
      case 'REGISTRATION_REQUIRED': {
        if (!response.registration) throw new Error('Invalid registration response');
        const updated = { ...recovery, expiresAt: response.registration.expiresAt, registration: response.registration };
        await this.recoveryStore.save(this.environment, updated);
        return this.safeView(updated);
      }
      case 'AUTHENTICATED': {
        if (!response.session) throw new Error('Invalid authenticated response');
        return this.activateSession(recovery, response.session, generation);
      }
      case 'DENIED': return this.finish(recovery, 'denied');
      case 'CANCELLED': return this.finish(recovery, 'cancelled');
      case 'FAILED': return this.finish(recovery, 'failed');
      case 'COMPLETED': return this.finish(recovery, 'resultUnavailable');
    }
  }

  private async activateSession(
    recovery: FederatedAuthRecovery,
    issued: IssuedSession,
    generation: number,
  ): Promise<FederatedAuthFlowView> {
    if (generation !== this.generation) {
      await this.session.revokeIssued(issued);
      throw superseded();
    }
    await this.session.establish(issued);
    if (generation !== this.generation) {
      await this.session.logout().catch(() => undefined);
      throw superseded();
    }
    await this.cleanup();
    return { status: 'authenticated', currentUser: issued.currentUser };
  }

  private safeView(recovery: FederatedAuthRecovery): FederatedAuthFlowView {
    if (recovery.registration) {
      return {
        status: 'registrationRequired',
        flowId: recovery.flowId,
        suggestedDisplayName: recovery.registration.suggestedDisplayName,
        ...(recovery.registration.suggestedAvatarUrl ? { suggestedAvatarUrl: recovery.registration.suggestedAvatarUrl } : {}),
        legalBundleVersion: recovery.registration.legalBundleVersion,
      };
    }
    return { status: 'waiting', flowId: recovery.flowId, expiresAt: recovery.expiresAt };
  }

  private async finish(
    recovery: FederatedAuthRecovery,
    status: 'denied' | 'cancelled' | 'expired' | 'failed' | 'resultUnavailable',
  ): Promise<FederatedAuthFlowView> {
    await this.cleanup();
    return { status, flowId: recovery.flowId };
  }

  private async requireRecovery(flowId: string): Promise<FederatedAuthRecovery> {
    const recovery = await this.recoveryStore.load(this.environment);
    if (!recovery || recovery.flowId !== flowId) throw contextInvalid('Federated flow unavailable');
    return recovery;
  }

  private async cancelRecovery(recovery: FederatedAuthRecovery, clearOperation = true): Promise<void> {
    if (clearOperation) this.operation = undefined;
    await this.client.cancel(recovery.attemptId, recovery.pollSecret).catch(() => undefined);
    await this.cleanup();
  }

  private isExpired(recovery: FederatedAuthRecovery) { return Date.parse(recovery.expiresAt) <= this.now(); }

  private async cleanupRejectedRecovery(error: unknown): Promise<boolean> {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code !== 'FEDERATED_LOGIN_CONTEXT_INVALID' && code !== 'FEDERATED_LOGIN_EXPIRED') return false;
    await this.cleanup().catch(() => undefined);
    return true;
  }

  private async cleanup() {
    await this.closeReceiver();
    await this.recoveryStore.clear(this.environment);
  }

  private async closeReceiver() {
    const receiver = this.receiver;
    this.receiver = undefined;
    await receiver?.close().catch(() => undefined);
  }
}

function contextInvalid(message: string) {
  return Object.assign(new Error(message), { code: 'FEDERATED_LOGIN_CONTEXT_INVALID' });
}

function superseded() {
  return Object.assign(new Error('Federated flow superseded'), { code: 'FEDERATED_LOGIN_CONTEXT_INVALID' });
}
