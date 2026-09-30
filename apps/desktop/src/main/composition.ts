import { randomUUID } from 'node:crypto';
import type { TaskPilotDesktopApi } from '../shared/contracts.js';
import type { HttpTransport, Environment } from './api/transport.js';
import { AuthClient, FlowCoordinator } from './auth/auth-client.js';
import type { CredentialStore } from './credentials/credential-store.js';
import { ProjectClient } from './projects/project-client.js';
import { SessionCoordinator } from './session/session-coordinator.js';
import { ActiveWorkspaceStore, type PreferenceStore } from './workspaces/active-workspace.js';
import { WorkspaceClient } from './workspaces/workspace-client.js';

export interface DesktopCompositionOptions {
  environment: Environment;
  transport: HttpTransport;
  credentials: CredentialStore;
  preferences: PreferenceStore;
  deviceInstallationId: string;
  createOperationId?: () => string;
}

export interface DesktopComposition {
  capabilities: Pick<TaskPilotDesktopApi, 'auth' | 'workspaces' | 'projects'>;
  session: SessionCoordinator;
  flows: FlowCoordinator;
}

export function createDesktopComposition(options: DesktopCompositionOptions): DesktopComposition {
  const createOperationId = options.createOperationId ?? randomUUID;
  const active = new ActiveWorkspaceStore(options.preferences);
  const flows = new FlowCoordinator(createOperationId);
  let listed: Awaited<ReturnType<WorkspaceClient['list']>>['items'] = [];
  const session = new SessionCoordinator(
    options.environment,
    options.credentials,
    {
      refresh: (refreshToken, refreshRequestId) => options.transport.request({ method: 'POST', path: '/desktop/v1/auth/session/refresh', body: { refreshToken, refreshRequestId } }),
      logout: accessToken => options.transport.request({ method: 'POST', path: '/desktop/v1/auth/session/logout', accessToken }),
    },
    createOperationId,
    {
      async clearProtectedState(userId) {
        listed = [];
        flows.clear();
        await active.clear(options.environment, userId);
      },
    },
  );
  const authClient = new AuthClient(options.transport, flows);
  const auth = {
    async signInWithPassword(input: { email: string; password: string }) { await session.establish(await authClient.signInWithPassword(input)); return session.view(); },
    requestLoginCode: (input: { email: string }) => authClient.requestLoginCode({ ...input, deviceInstallationId: options.deviceInstallationId }),
    async verifyLoginCode(input: { challengeId: string; email: string; code: string }) { await session.establish(await authClient.verifyLoginCode({ ...input, deviceInstallationId: options.deviceInstallationId })); return session.view(); },
    requestRegistrationCode: (input: { email: string }) => authClient.requestRegistrationCode({ ...input, deviceInstallationId: options.deviceInstallationId }),
    verifyRegistrationCode: (input: { challengeId: string; email: string; code: string }) => authClient.verifyRegistrationCode({ ...input, deviceInstallationId: options.deviceInstallationId }),
    async register(input: { flowHandle: string; email: string; displayName: string; password: string; termsVersion: string }) { await session.establish(await authClient.register(input)); return session.view(); },
    requestPasswordResetCode: (input: { email: string }) => authClient.requestPasswordResetCode({ ...input, deviceInstallationId: options.deviceInstallationId }),
    verifyPasswordResetCode: (input: { challengeId: string; email: string; code: string }) => authClient.verifyPasswordResetCode({ ...input, deviceInstallationId: options.deviceInstallationId }),
    resetPassword: (input: { flowHandle: string; email: string; newPassword: string }) => authClient.resetPassword(input),
    getSessionView: async () => session.view(),
    subscribeSessionView: (listener: Parameters<TaskPilotDesktopApi['auth']['subscribeSessionView']>[0]) => session.subscribe(listener),
    logout: () => session.logout(),
  };
  const workspaceClient = new WorkspaceClient(options.transport, session);
  const currentUserId = () => {
    const view = session.view();
    if (view.status !== 'authenticated') throw new Error('AUTHENTICATION_REQUIRED');
    return view.currentUser.userId;
  };
  const workspaces = {
    async listWorkspaces() { const result = await workspaceClient.list(); listed = result.items; return result; },
    createWorkspace: (input: { name: string; creationRequestId: string }) => workspaceClient.create(input),
    async restoreActiveWorkspace(input: { availableWorkspaceIds: string[] }) {
      const allowed = new Set(input.availableWorkspaceIds);
      return { workspaceId: await active.restore(options.environment, currentUserId(), listed.filter(item => allowed.has(item.workspaceId))) };
    },
    selectWorkspace: (input: { workspaceId: string }) => active.select(options.environment, currentUserId(), input.workspaceId),
    clearActiveWorkspace: () => active.clear(options.environment, currentUserId()),
  };
  const projectClient = new ProjectClient(options.transport, session);
  const projects = { listProjects: (input: { workspaceId: string; cursor?: string; limit?: number }) => projectClient.list(input) };
  return { capabilities: { auth, workspaces, projects }, session, flows };
}
