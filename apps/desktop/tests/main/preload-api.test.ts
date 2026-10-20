import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc.js';
import { createTaskPilotDesktopApi } from '../../src/preload/api.js';

const flowId = '11111111-1111-4111-8111-111111111111';
describe('createTaskPilotDesktopApi', () => {
  it('maps every Auth capability to its fixed IPC channel and preserves inputs', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const unsubscribe = vi.fn();
    const subscribe = vi.fn().mockReturnValue(unsubscribe);
    const api = createTaskPilotDesktopApi(invoke, subscribe);
    expect(Object.keys(api)).toEqual(['auth', 'workspaces', 'projects', 'boards']);
    const registration = {
      flowId, displayName: 'Ada', useSuggestedAvatar: true, legalBundleVersion: 'v1',
      termsVersion: 'terms-v1', privacyVersion: 'privacy-v1', locale: 'zh-CN',
    };
    const cases: Array<[() => Promise<unknown>, string, unknown?]> = [
      [() => api.auth.getCapabilities(), CHANNELS.getAuthCapabilities],
      [() => api.auth.startGitHubSignIn(), CHANNELS.startGitHubSignIn],
      [() => api.auth.continueGitHubSignIn({ flowId }), CHANNELS.continueGitHubSignIn, { flowId }],
      [() => api.auth.completeGitHubRegistration(registration), CHANNELS.completeGitHubRegistration, registration],
      [() => api.auth.cancelGitHubSignIn({ flowId }), CHANNELS.cancelGitHubSignIn, { flowId }],
      [() => api.auth.getSessionView(), CHANNELS.getSessionView],
      [() => api.auth.logout(), CHANNELS.logout],
      [() => api.workspaces.list(), CHANNELS.listWorkspaces],
      [() => api.projects.resolveHome(), CHANNELS.resolveProjectHome],
      [() => api.projects.list({ workspaceId: flowId, status: 'ACTIVE' }), CHANNELS.listProjects, { workspaceId: flowId, status: 'ACTIVE' }],
      [() => api.projects.open({ workspaceId: flowId, projectId: flowId }), CHANNELS.openProject, { workspaceId: flowId, projectId: flowId }],
      [() => api.projects.create({ workspaceId: flowId, requestId: flowId, name: 'Alpha', locale: 'en' }), CHANNELS.createProject, { workspaceId: flowId, requestId: flowId, name: 'Alpha', locale: 'en' }],
      [() => api.projects.edit({ workspaceId: flowId, projectId: flowId, expectedVersion: 1, name: 'Beta' }), CHANNELS.editProject, { workspaceId: flowId, projectId: flowId, expectedVersion: 1, name: 'Beta' }],
      [() => api.projects.archive({ workspaceId: flowId, projectId: flowId, expectedVersion: 1 }), CHANNELS.archiveProject, { workspaceId: flowId, projectId: flowId, expectedVersion: 1 }],
      [() => api.projects.restore({ workspaceId: flowId, projectId: flowId, expectedVersion: 1 }), CHANNELS.restoreProject, { workspaceId: flowId, projectId: flowId, expectedVersion: 1 }],
      [() => api.projects.permanentlyDelete({ workspaceId: flowId, projectId: flowId, expectedVersion: 1, confirmationName: 'Beta' }), CHANNELS.permanentlyDeleteProject, { workspaceId: flowId, projectId: flowId, expectedVersion: 1, confirmationName: 'Beta' }],
      [() => api.boards.resolveHome({ workspaceId: flowId, projectId: flowId }), CHANNELS.resolveBoardHome, { workspaceId: flowId, projectId: flowId }],
      [() => api.boards.list({ workspaceId: flowId, projectId: flowId }), CHANNELS.listBoards, { workspaceId: flowId, projectId: flowId }],
      [() => api.boards.open({ workspaceId: flowId, projectId: flowId, boardId: flowId }), CHANNELS.openBoard, { workspaceId: flowId, projectId: flowId, boardId: flowId }],
      [() => api.boards.create({ workspaceId: flowId, projectId: flowId, requestId: flowId, name: 'Board', locale: 'en' }), CHANNELS.createBoard, { workspaceId: flowId, projectId: flowId, requestId: flowId, name: 'Board', locale: 'en' }],
      [() => api.boards.edit({ workspaceId: flowId, projectId: flowId, boardId: flowId, expectedVersion: 1, name: 'Board' }), CHANNELS.editBoard, { workspaceId: flowId, projectId: flowId, boardId: flowId, expectedVersion: 1, name: 'Board' }],
      [() => api.boards.createColumn({ workspaceId: flowId, projectId: flowId, boardId: flowId, requestId: flowId, expectedBoardVersion: 1, name: 'Done' }), CHANNELS.createColumn, { workspaceId: flowId, projectId: flowId, boardId: flowId, requestId: flowId, expectedBoardVersion: 1, name: 'Done' }],
      [() => api.boards.editColumn({ workspaceId: flowId, projectId: flowId, boardId: flowId, columnId: flowId, expectedBoardVersion: 2, expectedColumnVersion: 0, name: 'Ready' }), CHANNELS.editColumn, { workspaceId: flowId, projectId: flowId, boardId: flowId, columnId: flowId, expectedBoardVersion: 2, expectedColumnVersion: 0, name: 'Ready' }],
      [() => api.boards.reorderColumns({ workspaceId: flowId, projectId: flowId, boardId: flowId, expectedBoardVersion: 2, columnIds: [flowId] }), CHANNELS.reorderColumns, { workspaceId: flowId, projectId: flowId, boardId: flowId, expectedBoardVersion: 2, columnIds: [flowId] }],
      [() => api.boards.deleteColumn({ workspaceId: flowId, projectId: flowId, boardId: flowId, columnId: flowId, expectedBoardVersion: 2, expectedColumnVersion: 0 }), CHANNELS.deleteColumn, { workspaceId: flowId, projectId: flowId, boardId: flowId, columnId: flowId, expectedBoardVersion: 2, expectedColumnVersion: 0 }],
      [() => api.boards.createWorkItem({ workspaceId: flowId, projectId: flowId, boardId: flowId, columnId: flowId, requestId: flowId, expectedBoardVersion: 2, title: 'Task' }), CHANNELS.createWorkItem, { workspaceId: flowId, projectId: flowId, boardId: flowId, columnId: flowId, requestId: flowId, expectedBoardVersion: 2, title: 'Task' }],
      [() => api.boards.openWorkItem({ workspaceId: flowId, projectId: flowId, workItemId: flowId }), CHANNELS.openWorkItem, { workspaceId: flowId, projectId: flowId, workItemId: flowId }],
      [() => api.boards.editWorkItem({ workspaceId: flowId, projectId: flowId, boardId: flowId, workItemId: flowId, currentColumnId: flowId, targetColumnId: flowId, expectedVersion: 0, title: 'Task' }), CHANNELS.editWorkItem, { workspaceId: flowId, projectId: flowId, boardId: flowId, workItemId: flowId, currentColumnId: flowId, targetColumnId: flowId, expectedVersion: 0, title: 'Task' }],
      [() => api.boards.moveCard({ workspaceId: flowId, projectId: flowId, boardId: flowId, workItemId: flowId, expectedBoardVersion: 2, expectedPlacementVersion: 0, targetColumnId: flowId }), CHANNELS.moveCard, { workspaceId: flowId, projectId: flowId, boardId: flowId, workItemId: flowId, expectedBoardVersion: 2, expectedPlacementVersion: 0, targetColumnId: flowId }],
    ];
    for (const [call, channel, input] of cases) {
      invoke.mockClear();
      await call();
      expect(invoke).toHaveBeenCalledWith(channel, input);
    }
    const listener = vi.fn();
    expect(api.auth.subscribeSessionView(listener)).toBe(unsubscribe);
    expect(subscribe).toHaveBeenCalledWith(listener);
  });

  it('unwraps successful values and rejects stable error envelopes', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { github: { enabled: true } } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'SESSION_EXPIRED', category: 'authentication', recovery: 'SIGN_IN' } });
    const api = createTaskPilotDesktopApi(invoke, () => vi.fn());
    await expect(api.auth.getCapabilities()).resolves.toEqual({ github: { enabled: true } });
    await expect(api.auth.logout()).rejects.toEqual({
      code: 'SESSION_EXPIRED', category: 'authentication', recovery: 'SIGN_IN',
    });
  });
});
