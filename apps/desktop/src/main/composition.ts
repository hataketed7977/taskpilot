import type { TaskPilotDesktopApi } from '../shared/contracts.js';
import type { Environment, HttpTransport } from './api/transport.js';
import { FederatedAuthClient } from './auth/auth-client.js';
import { FederatedAuthCoordinator, type DesktopWindowActivator, type ExternalBrowser } from './auth/federated-auth-coordinator.js';
import type { FederatedAuthRecoveryStore } from './auth/auth-recovery-store.js';
import { LoopbackReceiver } from './auth/loopback-receiver.js';
import type { CredentialStore } from './credentials/credential-store.js';
import { SessionCoordinator } from './session/session-coordinator.js';

export interface DesktopCompositionOptions {
  environment: Environment;
  transport: HttpTransport;
  credentials: CredentialStore;
  authRecovery: FederatedAuthRecoveryStore;
  deviceInstallationId: string;
  browser: ExternalBrowser;
  activateDesktop?: DesktopWindowActivator;
  loopback?: LoopbackReceiver;
  createOperationId?: () => string;
}
export interface DesktopComposition {
  capabilities: Pick<TaskPilotDesktopApi, 'auth'>;
  session: SessionCoordinator;
  federatedAuth: FederatedAuthCoordinator;
}

export function createDesktopComposition(options: DesktopCompositionOptions): DesktopComposition {
  const session = new SessionCoordinator(options.environment, options.credentials, {
    refresh: refreshToken => options.transport.request({
      method: 'POST', path: '/desktop/v1/auth/session/refresh', body: { refreshToken },
    }),
    logout: accessToken => options.transport.request({
      method: 'POST', path: '/desktop/v1/auth/session/logout', accessToken,
    }),
  });
  const federatedAuth = new FederatedAuthCoordinator(
    options.environment,
    options.deviceInstallationId,
    new FederatedAuthClient(options.transport),
    options.authRecovery,
    session,
    options.browser,
    options.loopback,
    options.createOperationId,
    Date.now,
    options.activateDesktop,
  );
  const auth: TaskPilotDesktopApi['auth'] = {
    getCapabilities: () => federatedAuth.capabilities(),
    startGitHubSignIn: () => federatedAuth.start(),
    continueGitHubSignIn: input => federatedAuth.continue(input.flowId),
    completeGitHubRegistration: input => federatedAuth.register(input),
    cancelGitHubSignIn: input => federatedAuth.cancel(input.flowId),
    getSessionView: async () => session.view(),
    subscribeSessionView: listener => session.subscribe(listener),
    logout: () => session.logout(),
  };
  return { capabilities: { auth }, session, federatedAuth };
}
