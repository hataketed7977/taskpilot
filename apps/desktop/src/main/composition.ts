import type { TaskPilotDesktopApi } from '../shared/contracts.js';
import type { Environment, HttpTransport } from './api/transport.js';
import { FederatedAuthClient } from './auth/auth-client.js';
import { FederatedAuthCoordinator, type DesktopWindowActivator, type ExternalBrowser } from './auth/federated-auth-coordinator.js';
import type { FederatedAuthRecoveryStore } from './auth/auth-recovery-store.js';
import { LoopbackReceiver } from './auth/loopback-receiver.js';
import type { CredentialStore } from './credentials/credential-store.js';
import { WorkspaceProjectClient } from './projects/project-client.js';
import { ProjectWorkClient } from './projects/project-work-client.js';
import { ProjectWorkCoordinator } from './projects/project-work-coordinator.js';
import { MemoryRecentBoardStore, type RecentBoardStore } from './projects/recent-board-store.js';
import { ProjectHomeCoordinator } from './projects/project-home-coordinator.js';
import { MemoryRecentProjectStore, type RecentProjectStore } from './projects/recent-project-store.js';
import { SessionCoordinator } from './session/session-coordinator.js';

export interface DesktopCompositionOptions {
  environment: Environment;
  transport: HttpTransport;
  credentials: CredentialStore;
  authRecovery: FederatedAuthRecoveryStore;
  recentProjects?: RecentProjectStore;
  recentBoards?: RecentBoardStore;
  deviceInstallationId: string;
  browser: ExternalBrowser;
  activateDesktop?: DesktopWindowActivator;
  loopback?: LoopbackReceiver;
  createOperationId?: () => string;
}
export interface DesktopComposition {
  capabilities: TaskPilotDesktopApi;
  session: SessionCoordinator;
  federatedAuth: FederatedAuthCoordinator;
  projectHome: ProjectHomeCoordinator;
  projectWork: ProjectWorkCoordinator;
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
  const projectHome = new ProjectHomeCoordinator(
    options.environment,
    session,
    new WorkspaceProjectClient(options.transport),
    options.recentProjects ?? new MemoryRecentProjectStore(),
  );
  const projectWork = new ProjectWorkCoordinator(
    options.environment,
    session,
    new ProjectWorkClient(options.transport),
    options.recentBoards ?? new MemoryRecentBoardStore(),
  );
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
    bootstrap => projectHome.acceptBootstrap(bootstrap),
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
  const workspaces: TaskPilotDesktopApi['workspaces'] = {
    list: () => projectHome.listWorkspaces(),
  };
  const projects: TaskPilotDesktopApi['projects'] = {
    resolveHome: () => projectHome.resolveHome(),
    list: input => projectHome.list(input),
    open: input => projectHome.open(input),
    create: input => projectHome.create(input),
    edit: input => projectHome.edit(input),
    archive: input => projectHome.archive(input),
    restore: input => projectHome.restore(input),
    permanentlyDelete: input => projectHome.permanentlyDelete(input),
  };
  const boards: TaskPilotDesktopApi['boards'] = {
    resolveHome: input => projectWork.resolveHome(input),
    list: input => projectWork.list(input),
    open: input => projectWork.open(input),
    create: input => projectWork.create(input),
    edit: input => projectWork.edit(input),
    permanentlyDelete: input => projectWork.permanentlyDeleteBoard(input),
    createColumn: input => projectWork.createColumn(input),
    editColumn: input => projectWork.editColumn(input),
    reorderColumns: input => projectWork.reorderColumns(input),
    deleteColumn: input => projectWork.deleteColumn(input),
    createWorkItem: input => projectWork.createWorkItem(input),
    openWorkItem: input => projectWork.openWorkItem(input),
    editWorkItem: input => projectWork.editWorkItem(input),
    moveCard: input => projectWork.moveCard(input),
  };
  return { capabilities: { auth, workspaces, projects, boards }, session, federatedAuth, projectHome, projectWork };
}
