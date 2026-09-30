import { describe, expect, it, vi } from 'vitest';
import type { HttpTransport, TransportRequest } from '../../src/main/api/transport.js';
import { createDesktopComposition } from '../../src/main/composition.js';
import { MemoryCredentialStore } from '../../src/main/credentials/credential-store.js';
import { MemoryPreferenceStore } from '../../src/main/workspaces/active-workspace.js';

const user = {
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Ada',
  email: 'ada@example.com',
};
const workspace = {
  workspaceId: '22222222-2222-4222-8222-222222222222',
  name: 'Acme',
  type: 'ORGANIZATION' as const,
};
const project = {
  projectId: '33333333-3333-4333-8333-333333333333',
  workspaceId: workspace.workspaceId,
  name: 'Launch',
};
const session = (suffix: string) => ({
  accessToken: `access-${suffix}`,
  accessTokenExpiresAt: '2030-01-01T00:00:00Z',
  refreshToken: `refresh-${suffix}`,
  refreshTokenExpiresAt: '2030-02-01T00:00:00Z',
  currentUser: user,
});

function transportFixture() {
  const request = vi.fn(async (input: TransportRequest): Promise<unknown> => {
    switch (input.path) {
      case '/desktop/v1/auth/login/password':
      case '/desktop/v1/auth/login/code/verify':
      case '/desktop/v1/auth/registration':
        return session(input.path.split('/').at(-1) ?? 'issued');
      case '/desktop/v1/auth/session/refresh':
        return session('refreshed');
      case '/desktop/v1/auth/session/logout':
      case '/desktop/v1/auth/password-reset':
        return undefined;
      case '/desktop/v1/auth/login/code':
      case '/desktop/v1/auth/registration/code':
      case '/desktop/v1/auth/password-reset/code':
        return { challengeId: `${input.path}-challenge`, retryAfterSeconds: 30 };
      case '/desktop/v1/auth/registration/code/verify':
      case '/desktop/v1/auth/password-reset/code/verify':
        return {
          continuationId: `${input.path}-continuation`,
          continuationSecret: 'server-secret',
          expiresAt: '2030-01-01T00:10:00Z',
        };
      case '/desktop/v1/workspaces':
        return input.method === 'GET'
          ? { items: [workspace], capabilities: { canCreateWorkspace: true } }
          : workspace;
      case `/desktop/v1/workspaces/${workspace.workspaceId}/projects?limit=50`:
        return { items: [project] };
      default:
        throw new Error(`Unexpected request: ${input.method} ${input.path}`);
    }
  });
  return { request } satisfies HttpTransport;
}

describe('createDesktopComposition', () => {
  it('wires every auth, workspace, and project capability through the owning clients', async () => {
    const transport = transportFixture();
    const credentials = new MemoryCredentialStore();
    const preferences = new MemoryPreferenceStore();
    let operation = 0;
    const composition = createDesktopComposition({
      environment: 'production',
      transport,
      credentials,
      preferences,
      deviceInstallationId: 'device-1',
      createOperationId: () => `operation-${++operation}`,
    });
    const { auth, workspaces, projects } = composition.capabilities;
    const observed = vi.fn();
    const unsubscribe = auth.subscribeSessionView(observed);

    await expect(auth.getSessionView()).resolves.toEqual({ status: 'signedOut' });
    await expect(auth.signInWithPassword({ email: user.email, password: 'Password!234' }))
      .resolves.toMatchObject({ status: 'authenticated', currentUser: user });
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ status: 'authenticated' }));

    await expect(auth.requestLoginCode({ email: user.email })).resolves.toMatchObject({ retryAfterSeconds: 30 });
    await expect(auth.verifyLoginCode({ challengeId: 'login-challenge', email: user.email, code: '123456' }))
      .resolves.toMatchObject({ status: 'authenticated' });

    await expect(auth.requestRegistrationCode({ email: user.email })).resolves.toMatchObject({ retryAfterSeconds: 30 });
    const registration = await auth.verifyRegistrationCode({ challengeId: 'registration-challenge', email: user.email, code: '123456' });
    await expect(auth.register({
      flowHandle: registration.flowHandle,
      email: user.email,
      displayName: user.displayName,
      password: 'Password!234',
      termsVersion: '2026-01',
    })).resolves.toMatchObject({ status: 'authenticated' });

    await expect(auth.requestPasswordResetCode({ email: user.email })).resolves.toMatchObject({ retryAfterSeconds: 30 });
    const reset = await auth.verifyPasswordResetCode({ challengeId: 'reset-challenge', email: user.email, code: '123456' });
    await expect(auth.resetPassword({ flowHandle: reset.flowHandle, email: user.email, newPassword: 'NewPassword!234' }))
      .resolves.toBeUndefined();

    await expect(workspaces.listWorkspaces()).resolves.toEqual({
      items: [workspace],
      capabilities: { canCreateWorkspace: true },
    });
    await expect(workspaces.restoreActiveWorkspace({ availableWorkspaceIds: [workspace.workspaceId] }))
      .resolves.toEqual({ workspaceId: workspace.workspaceId });
    await expect(workspaces.selectWorkspace({ workspaceId: workspace.workspaceId })).resolves.toBeUndefined();
    await expect(workspaces.clearActiveWorkspace()).resolves.toBeUndefined();
    await expect(workspaces.createWorkspace({ name: workspace.name, creationRequestId: 'create-1' })).resolves.toEqual(workspace);
    await expect(projects.listProjects({ workspaceId: workspace.workspaceId })).resolves.toEqual({ items: [project] });

    await expect(auth.logout()).resolves.toBeUndefined();
    expect(await credentials.loadCurrent('production')).toBeUndefined();
    unsubscribe();

    expect(transport.request).toHaveBeenCalledWith(expect.objectContaining({
      path: '/desktop/v1/auth/login/code',
      body: expect.objectContaining({ deviceInstallationId: 'device-1' }),
    }));
    expect(transport.request).toHaveBeenCalledWith(expect.objectContaining({
      path: '/desktop/v1/workspaces',
      idempotencyKey: 'create-1',
    }));
    expect(transport.request).toHaveBeenCalledWith(expect.objectContaining({
      path: `/desktop/v1/workspaces/${workspace.workspaceId}/projects?limit=50`,
    }));
  });

  it('clears cached flow and active workspace state when protected state is cleared', async () => {
    const transport = transportFixture();
    const preferences = new MemoryPreferenceStore();
    const composition = createDesktopComposition({
      environment: 'local',
      transport,
      credentials: new MemoryCredentialStore(),
      preferences,
      deviceInstallationId: 'device-2',
      createOperationId: () => 'stable-handle',
    });
    const { auth, workspaces } = composition.capabilities;
    await auth.signInWithPassword({ email: user.email, password: 'Password!234' });
    await workspaces.listWorkspaces();
    await workspaces.selectWorkspace({ workspaceId: workspace.workspaceId });
    const registration = await auth.verifyRegistrationCode({ challengeId: 'challenge', email: user.email, code: '123456' });

    await auth.logout();
    await expect(auth.register({
      flowHandle: registration.flowHandle,
      email: user.email,
      displayName: user.displayName,
      password: 'Password!234',
      termsVersion: '2026-01',
    })).rejects.toThrow('REGISTRATION_CONTEXT_EXPIRED');
  });
});
