import { describe, expect, it, vi } from 'vitest';
import type { HttpTransport, TransportRequest } from '../../src/main/api/transport.js';
import { MemoryFederatedAuthRecoveryStore } from '../../src/main/auth/auth-recovery-store.js';
import type { LoopbackReceiver } from '../../src/main/auth/loopback-receiver.js';
import { createDesktopComposition } from '../../src/main/composition.js';
import { MemoryCredentialStore } from '../../src/main/credentials/credential-store.js';

const user = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' };
const issued = {
  accessToken: 'access-token', accessTokenExpiresAt: '2030-01-01T00:00:00Z',
  refreshToken: 'refresh-token', refreshTokenExpiresAt: '2030-02-01T00:00:00Z', currentUser: user,
};
const nonce = 'abcdefghijklmnopqrstuvwxyzABCDEF';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const project = { projectId, workspaceId, name: 'My project', description: '', status: 'ACTIVE', version: 1, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z', archivedAt: null };
const completionUri = `http://127.0.0.1:50000/taskpilot/oauth/complete/${nonce}`;

function fixture() {
  const proof = Promise.withResolvers<string>();
  const request = vi.fn(async (input: TransportRequest): Promise<unknown> => {
    switch (input.path) {
      case '/desktop/v1/auth/capabilities': return { github: { enabled: true } };
      case '/desktop/v1/auth/federated/attempts': return {
        attemptId: 'attempt-id', pollSecret: 'poll-secret-value',
        authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=client',
        expiresAt: '2030-01-01T00:00:00Z',
      };
      case '/desktop/v1/auth/federated/attempts/attempt-id/poll': return { status: 'AUTHENTICATED', session: issued, bootstrap: { workspaceId, projectId } };
      case '/desktop/v1/workspaces': return [{ workspaceId, type: 'PERSONAL', role: 'OWNER', createdAt: project.createdAt, updatedAt: project.updatedAt }];
      case `/desktop/v1/workspaces/${workspaceId}/projects/${projectId}`: return project;
      case `/desktop/v1/workspaces/${workspaceId}/projects?status=ACTIVE&limit=50`: return { items: [project], nextCursor: null };
      case '/desktop/v1/auth/session/refresh': return { ...issued, accessToken: 'access-rotated', refreshToken: 'refresh-rotated' };
      case '/desktop/v1/auth/session/logout': return undefined;
      case '/desktop/v1/auth/federated/attempts/attempt-id/cancel': return undefined;
      default: throw new Error(`Unexpected request: ${input.method} ${input.path}`);
    }
  });
  const browser = { open: vi.fn().mockResolvedValue(undefined) };
  const authRecovery = new MemoryFederatedAuthRecoveryStore();
  const credentials = new MemoryCredentialStore();
  const composition = createDesktopComposition({
    environment: 'production', transport: { request } satisfies HttpTransport,
    credentials, authRecovery, deviceInstallationId: 'device-1', browser,
    activateDesktop: vi.fn(),
    loopback: { start: vi.fn().mockResolvedValue({
      completionUri, nonce, proof: proof.promise, close: vi.fn().mockResolvedValue(undefined),
    }) } as unknown as LoopbackReceiver,
    createOperationId: () => '11111111-1111-4111-8111-111111111111',
  });
  return { composition, request, browser, proof, credentials };
}

describe('createDesktopComposition', () => {
  it('exposes narrow Auth, Workspace and Project capabilities and wires GitHub login to session establishment', async () => {
    const current = fixture();
    expect(Object.keys(current.composition.capabilities)).toEqual(['auth', 'workspaces', 'projects']);
    const { auth } = current.composition.capabilities;
    const observed = vi.fn();
    auth.subscribeSessionView(observed);

    await expect(auth.getCapabilities()).resolves.toEqual({ github: { enabled: true } });
    const started = await auth.startGitHubSignIn();
    expect(current.browser.open).toHaveBeenCalled();
    if (started.status !== 'waiting') throw new Error('unexpected flow');
    await expect(auth.continueGitHubSignIn({ flowId: started.flowId })).resolves.toEqual({
      status: 'authenticated', currentUser: user,
    });
    expect(observed).toHaveBeenCalledWith({ status: 'authenticated', currentUser: user });
    expect(await current.credentials.loadCurrent('production')).toMatchObject({ refreshToken: 'refresh-token' });
    await expect(current.composition.capabilities.projects.resolveHome()).resolves.toMatchObject({ value: { currentProject: { projectId } } });
  });

  it('refreshes with only the opaque refresh token and logs out', async () => {
    const current = fixture();
    const { auth } = current.composition.capabilities;
    const started = await auth.startGitHubSignIn();
    if (started.status !== 'waiting') throw new Error('unexpected flow');
    await auth.continueGitHubSignIn({ flowId: started.flowId });

    await current.composition.session.refresh();
    expect(current.request).toHaveBeenCalledWith({
      method: 'POST', path: '/desktop/v1/auth/session/refresh', body: { refreshToken: 'refresh-token' },
    });
    await auth.logout();
    await expect(auth.getSessionView()).resolves.toEqual({ status: 'signedOut' });
  });
});
