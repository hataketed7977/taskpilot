import { describe, expect, it, vi } from 'vitest';
import { WorkspaceClient } from '../../src/main/workspaces/workspace-client.js';
import { OutcomeUnknownError } from '../../src/main/api/transport.js';
import { ProjectClient, projectQueryKey } from '../../src/main/projects/project-client.js';
import { MemoryCredentialStore } from '../../src/main/credentials/credential-store.js';
import { SessionCoordinator } from '../../src/main/session/session-coordinator.js';

const session = { protected: <T>(operation: (token: string) => Promise<T>) => operation('secret-access') };

describe('WorkspaceClient', () => {
  it('maps creationRequestId only to Idempotency-Key and sends a narrow body', async () => {
    const request = vi.fn().mockResolvedValue({ workspaceId: '11111111-1111-4111-8111-111111111111', name: 'North Star', type: 'ORGANIZATION' });
    const client = new WorkspaceClient({ request } as never, session as never);
    await client.create({ name: 'North Star', creationRequestId: '22222222-2222-4222-8222-222222222222' });
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/desktop/v1/workspaces', accessToken: 'secret-access', idempotencyKey: '22222222-2222-4222-8222-222222222222', body: { name: 'North Star' }, outcomeUnknownOnNetworkFailure: true });
  });

  it('parses PERSONAL as a transport-compatible type without adding a creation path', async () => {
    const request = vi.fn().mockResolvedValue({ items: [{ workspaceId: '11111111-1111-4111-8111-111111111111', name: 'Personal', type: 'PERSONAL' }], capabilities: { canCreateWorkspace: false } });
    await expect(new WorkspaceClient({ request } as never, session as never).list()).resolves.toMatchObject({ items: [{ type: 'PERSONAL' }] });
  });

  it('maps an indeterminate create response to the stable Workspace recovery code', async () => {
    const request = vi.fn().mockRejectedValue(new OutcomeUnknownError());
    const client = new WorkspaceClient({ request } as never, session as never);
    await expect(client.create({ name: 'North Star', creationRequestId: '22222222-2222-4222-8222-222222222222' }))
      .rejects.toMatchObject({ code: 'WORKSPACE_RESULT_UNKNOWN', recovery: 'RETRY' });
  });

});

describe('ProjectClient', () => {
  it('passes opaque cursor only through the fixed query and rejects item scope mismatch', async () => {
    const request = vi.fn().mockResolvedValue({ items: [{ projectId: '22222222-2222-4222-8222-222222222222', workspaceId: '33333333-3333-4333-8333-333333333333', name: 'Wrong' }] });
    const client = new ProjectClient({ request } as never, session as never);
    await expect(client.list({ workspaceId: '11111111-1111-4111-8111-111111111111', cursor: 'opaque.token_1', limit: 50 })).rejects.toMatchObject({ code: 'PROJECT_SCOPE_MISMATCH' });
    expect(request.mock.calls[0][0].path).toBe('/desktop/v1/workspaces/11111111-1111-4111-8111-111111111111/projects?cursor=opaque.token_1&limit=50');
  });

  it('uses the shared single-flight 401 recovery and retries the fixed Project request once', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const user = { userId: '22222222-2222-4222-8222-222222222222', displayName: 'Ada', email: 'ada@example.com' };
    const issued = (suffix: string) => ({
      accessToken: `access-${suffix}`, accessTokenExpiresAt: '2030-01-01T00:00:00Z',
      refreshToken: `refresh-${suffix}`, refreshTokenExpiresAt: '2030-02-01T00:00:00Z', currentUser: user,
    });
    const refresh = vi.fn().mockResolvedValue(issued('2'));
    const coordinator = new SessionCoordinator('production', new MemoryCredentialStore(), { refresh, logout: vi.fn() }, () => 'refresh-request');
    await coordinator.establish(issued('1'));
    const unauthorized = Object.assign(new Error('unauthorized'), { status: 401 });
    const request = vi.fn()
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce({ items: [{ projectId: '33333333-3333-4333-8333-333333333333', workspaceId, name: 'Launch' }] });

    await expect(new ProjectClient({ request } as never, coordinator).list({ workspaceId })).resolves.toMatchObject({ items: [{ name: 'Launch' }] });
    expect(refresh).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([value]) => value.accessToken)).toEqual(['access-1', 'access-2']);
    expect(request.mock.calls[0][0].path).toBe(`/desktop/v1/workspaces/${workspaceId}/projects?limit=50`);
  });

  it('keys state by environment, user and workspace', () => {
    expect(projectQueryKey('production', 'user-a', 'workspace-a')).not.toBe(projectQueryKey('production', 'user-b', 'workspace-a'));
    expect(projectQueryKey('production', 'user-a', 'workspace-a')).not.toBe(projectQueryKey('local', 'user-a', 'workspace-a'));
  });
});
