import { describe, expect, it, vi } from 'vitest';
import { TransportError } from '../../../src/main/api/transport.js';
import { MemoryCredentialStore } from '../../../src/main/credentials/credential-store.js';
import { ProjectHomeCoordinator } from '../../../src/main/projects/project-home-coordinator.js';
import { MemoryRecentProjectStore } from '../../../src/main/projects/recent-project-store.js';
import { SessionCoordinator } from '../../../src/main/session/session-coordinator.js';

const userA = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' };
const userB = { userId: '22222222-2222-4222-8222-222222222222', displayName: 'Grace' };
const workspaceId = '33333333-3333-4333-8333-333333333333';
const firstId = '44444444-4444-4444-8444-444444444444';
const recentId = '55555555-5555-4555-8555-555555555555';
const bootstrapId = '66666666-6666-4666-8666-666666666666';
const workspace = { workspaceId, type: 'PERSONAL' as const, role: 'OWNER' as const, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z' };
const project = (projectId: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') => ({ projectId, workspaceId, name: projectId, description: '', status, version: 1, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z', archivedAt: status === 'ARCHIVED' ? '2030-01-02T00:00:00Z' : null });
const issued = (user = userA, suffix = 'a') => ({ accessToken: `access-${suffix}`, accessTokenExpiresAt: '2030-01-01T00:00:00Z', refreshToken: `refresh-${suffix}`, refreshTokenExpiresAt: '2030-02-01T00:00:00Z', currentUser: user });

function fixture() {
  const session = new SessionCoordinator('production', new MemoryCredentialStore(), { refresh: vi.fn(), logout: vi.fn() });
  const preferences = new MemoryRecentProjectStore();
  const client = {
    listWorkspaces: vi.fn().mockResolvedValue([workspace]),
    listProjects: vi.fn().mockResolvedValue({ items: [project(firstId)], nextCursor: null }),
    getProject: vi.fn(async (_token: string, input: { projectId: string }) => project(input.projectId)),
    createProject: vi.fn(), editProject: vi.fn(), archiveProject: vi.fn(), restoreProject: vi.fn(), permanentlyDeleteProject: vi.fn(),
  };
  const coordinator = new ProjectHomeCoordinator('production', session, client, preferences);
  return { session, preferences, client, coordinator };
}

describe('ProjectHomeCoordinator', () => {
  it('validates and selects the first-registration bootstrap before any stored preference', async () => {
    const current = fixture();
    await current.session.establish(issued());
    await current.preferences.save('production', userA.userId, recentId);
    current.coordinator.acceptBootstrap({ workspaceId, projectId: bootstrapId });

    await expect(current.coordinator.resolveHome()).resolves.toMatchObject({ value: { currentProject: { projectId: bootstrapId } } });
    expect(current.client.getProject).toHaveBeenCalledWith('access-a', { workspaceId, projectId: bootstrapId });
    expect(await current.preferences.load('production', userA.userId)).toBe(bootstrapId);
  });

  it('uses a valid recent Project and falls back when it is archived, deleted or inaccessible', async () => {
    const current = fixture();
    await current.session.establish(issued());
    await current.preferences.save('production', userA.userId, recentId);
    current.client.getProject.mockResolvedValueOnce(project(recentId));
    await expect(current.coordinator.resolveHome()).resolves.toMatchObject({ value: { currentProject: { projectId: recentId } } });

    current.client.getProject.mockResolvedValueOnce(project(recentId, 'ARCHIVED'));
    await expect(current.coordinator.resolveHome()).resolves.toMatchObject({ value: { currentProject: { projectId: firstId } } });

    await current.preferences.save('production', userA.userId, recentId);
    current.client.getProject.mockRejectedValueOnce(new TransportError({ code: 'PROJECT_NOT_FOUND', category: 'unknown' }, 404));
    await expect(current.coordinator.resolveHome()).resolves.toMatchObject({ value: { currentProject: { projectId: firstId } } });
  });

  it('loads every ACTIVE Project page for the home switcher', async () => {
    const current = fixture();
    await current.session.establish(issued());
    const secondId = '66666666-6666-4666-8666-666666666666';
    current.client.listProjects
      .mockResolvedValueOnce({ items: [project(firstId)], nextCursor: 'next-active-page' })
      .mockResolvedValueOnce({ items: [project(secondId)], nextCursor: null });

    await expect(current.coordinator.resolveHome()).resolves.toMatchObject({
      value: { projects: [{ projectId: firstId }, { projectId: secondId }] },
    });
    expect(current.client.listProjects).toHaveBeenNthCalledWith(1, 'access-a', {
      workspaceId, status: 'ACTIVE', limit: 50,
    });
    expect(current.client.listProjects).toHaveBeenNthCalledWith(2, 'access-a', {
      workspaceId, status: 'ACTIVE', limit: 50, cursor: 'next-active-page',
    });
  });

  it('returns an empty home when the personal Workspace has no ACTIVE Project', async () => {
    const current = fixture();
    await current.session.establish(issued());
    current.client.listProjects.mockResolvedValue({ items: [], nextCursor: null });
    await expect(current.coordinator.resolveHome()).resolves.toMatchObject({ value: { workspace, projects: [] } });
  });

  it('binds a successful create response to the created Project before Renderer fencing', async () => {
    const current = fixture();
    await current.session.establish(issued());
    current.client.createProject.mockResolvedValue(project(recentId));

    await expect(current.coordinator.create({
      workspaceId,
      requestId: '77777777-7777-4777-8777-777777777777',
      name: 'Release readiness',
      description: '',
    })).resolves.toMatchObject({
      key: { userId: userA.userId, workspaceId, projectId: recentId },
      value: { projectId: recentId },
    });
    expect(await current.preferences.load('production', userA.userId)).toBe(recentId);
  });

  it('degrades preference read/write failure without blocking deterministic fallback', async () => {
    const current = fixture();
    current.preferences.load = vi.fn().mockRejectedValue(new Error('disk unavailable'));
    current.preferences.save = vi.fn().mockRejectedValue(new Error('disk unavailable'));
    await current.session.establish(issued());
    await expect(current.coordinator.resolveHome()).resolves.toMatchObject({ value: { currentProject: { projectId: firstId } } });
  });



  it('remembers only the latest open intent when responses arrive out of order', async () => {
    const current = fixture();
    const older = Promise.withResolvers<ReturnType<typeof project>>();
    const latest = Promise.withResolvers<ReturnType<typeof project>>();
    current.client.getProject.mockImplementation((_token, input) => input.projectId === recentId ? older.promise : latest.promise);
    await current.session.establish(issued());

    const olderOpen = current.coordinator.open({ workspaceId, projectId: recentId });
    const latestOpen = current.coordinator.open({ workspaceId, projectId: bootstrapId });
    latest.resolve(project(bootstrapId));
    await latestOpen;
    older.resolve(project(recentId));
    await olderOpen;

    expect(await current.preferences.load('production', userA.userId)).toBe(bootstrapId);
  });

  it('clears the session when a Project request gets 401 and refresh cannot recover it', async () => {
    const credentials = new MemoryCredentialStore();
    const session = new SessionCoordinator('production', credentials, {
      refresh: vi.fn().mockRejectedValue(Object.assign(new Error('revoked'), { status: 401 })), logout: vi.fn(),
    });
    const current = fixture();
    const coordinator = new ProjectHomeCoordinator('production', session, current.client, current.preferences);
    await session.establish(issued());
    current.client.listWorkspaces.mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 401 }));

    await expect(coordinator.resolveHome()).rejects.toMatchObject({ status: 401 });
    expect(session.view()).toEqual({ status: 'signedOut' });
    expect(await credentials.loadCurrent('production')).toBeUndefined();
  });

  it('drops a late response after logout or account switch and never reads the previous User preference', async () => {
    const current = fixture();
    const pending = Promise.withResolvers<typeof workspace[]>();
    current.client.listWorkspaces.mockReturnValueOnce(pending.promise);
    await current.session.establish(issued(userA, 'a'));
    const late = current.coordinator.resolveHome();
    await current.session.logout();
    await current.session.establish(issued(userB, 'b'));
    pending.resolve([workspace]);

    await expect(late).rejects.toMatchObject({ code: 'SESSION_CONTEXT_SUPERSEDED' });
    expect(await current.preferences.load('production', userB.userId)).toBeUndefined();
  });
});
