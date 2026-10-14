import { describe, expect, it, vi } from 'vitest';
import type { HttpTransport } from '../../src/main/api/transport.js';
import { WorkspaceProjectClient } from '../../src/main/projects/project-client.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const project = {
  projectId, workspaceId, name: 'Alpha', description: '', status: 'ACTIVE' as const, version: 1,
  createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z', archivedAt: null,
};

describe('WorkspaceProjectClient', () => {
  it('uses fixed typed Workspace and Project contracts', async () => {
    const request = vi.fn(async input => {
      if (input.path === '/desktop/v1/workspaces') return [{ workspaceId, type: 'PERSONAL', role: 'OWNER', createdAt: project.createdAt, updatedAt: project.updatedAt }];
      if (input.method === 'GET' && input.path.includes('?')) return { items: [project], nextCursor: null };
      if (input.path.endsWith('/permanent-deletion')) return undefined;
      return project;
    });
    const client = new WorkspaceProjectClient({ request } as HttpTransport);
    const token = 'access-secret';

    await client.listWorkspaces(token);
    await client.listProjects(token, { workspaceId, status: 'ACTIVE', limit: 50, cursor: 'opaque/cursor+' });
    await client.getProject(token, { workspaceId, projectId });
    await client.createProject(token, { workspaceId, requestId, name: 'Alpha', description: '' });
    await client.editProject(token, { workspaceId, projectId, expectedVersion: 1, name: 'Beta', description: 'Notes' });
    await client.archiveProject(token, { workspaceId, projectId, expectedVersion: 2 });
    await client.restoreProject(token, { workspaceId, projectId, expectedVersion: 3 });
    await client.permanentlyDeleteProject(token, { workspaceId, projectId, expectedVersion: 4, confirmationName: 'Beta' });

    expect(request.mock.calls.map(([value]) => `${value.method} ${value.path}`)).toEqual([
      'GET /desktop/v1/workspaces',
      `GET /desktop/v1/workspaces/${workspaceId}/projects?status=ACTIVE&limit=50&cursor=opaque%2Fcursor%2B`,
      `GET /desktop/v1/workspaces/${workspaceId}/projects/${projectId}`,
      `POST /desktop/v1/workspaces/${workspaceId}/projects`,
      `PATCH /desktop/v1/workspaces/${workspaceId}/projects/${projectId}`,
      `POST /desktop/v1/workspaces/${workspaceId}/projects/${projectId}/archive`,
      `POST /desktop/v1/workspaces/${workspaceId}/projects/${projectId}/restore`,
      `POST /desktop/v1/workspaces/${workspaceId}/projects/${projectId}/permanent-deletion`,
    ]);
    expect(request.mock.calls[3]?.[0]).toMatchObject({ accessToken: token, body: { requestId, name: 'Alpha', description: '' } });
  });

  it('rejects malformed server responses at the Main trust boundary', async () => {
    const client = new WorkspaceProjectClient({ request: vi.fn().mockResolvedValue([{ type: 'TEAM' }]) } as HttpTransport);
    await expect(client.listWorkspaces('token')).rejects.toThrow();
  });
});
