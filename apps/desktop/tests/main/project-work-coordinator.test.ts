import { describe, expect, it, vi } from 'vitest';
import { MemoryCredentialStore } from '../../src/main/credentials/credential-store.js';
import { ProjectWorkCoordinator } from '../../src/main/projects/project-work-coordinator.js';
import { MemoryRecentBoardStore } from '../../src/main/projects/recent-board-store.js';
import { SessionCoordinator } from '../../src/main/session/session-coordinator.js';

const userA = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' };
const userB = { userId: '22222222-2222-4222-8222-222222222222', displayName: 'Grace' };
const workspaceId = '33333333-3333-4333-8333-333333333333';
const projectId = '44444444-4444-4444-8444-444444444444';
const firstId = '55555555-5555-4555-8555-555555555555';
const recentId = '66666666-6666-4666-8666-666666666666';
const columnId = '77777777-7777-4777-8777-777777777777';
const now = '2030-01-01T00:00:00Z';
const summary = (boardId: string) => ({ boardId, projectId, name: boardId, description: '', version: 0, createdAt: now, updatedAt: now });
const board = (boardId: string, version = 0) => ({ ...summary(boardId), version, columns: [{ columnId, name: 'To do', position: 0, version: 0, createdAt: now, updatedAt: now, cards: [] }] });
const issued = (user = userA, suffix = 'a') => ({ accessToken: `access-${suffix}`, accessTokenExpiresAt: now, refreshToken: `refresh-${suffix}`, refreshTokenExpiresAt: '2030-02-01T00:00:00Z', currentUser: user });

function fixture() {
  const session = new SessionCoordinator('production', new MemoryCredentialStore(), { refresh: vi.fn(), logout: vi.fn() });
  const preferences = new MemoryRecentBoardStore();
  const client = {
    listBoards: vi.fn().mockResolvedValue([summary(firstId), summary(recentId)]),
    getBoard: vi.fn(async (_token, input) => board(input.boardId)),
    createBoard: vi.fn(), editBoard: vi.fn(), createColumn: vi.fn(), editColumn: vi.fn(), reorderColumns: vi.fn(),
    deleteColumn: vi.fn(), createWorkItem: vi.fn(), getWorkItem: vi.fn(), editWorkItem: vi.fn(), moveCard: vi.fn(),
  };
  return { session, preferences, client, coordinator: new ProjectWorkCoordinator('production', session, client, preferences) };
}

describe('ProjectWorkCoordinator', () => {
  it('restores the scoped recent Board and falls back to the earliest Board', async () => {
    const current = fixture();
    await current.session.establish(issued());
    await expect(current.coordinator.resolveHome({ workspaceId, projectId })).resolves.toMatchObject({ value: { currentBoard: { boardId: firstId } } });
    await current.preferences.save('production', userA.userId, workspaceId, projectId, recentId);
    await expect(current.coordinator.resolveHome({ workspaceId, projectId })).resolves.toMatchObject({ value: { currentBoard: { boardId: recentId } } });
  });

  it('marks an earlier Board read stale after a successful mutation', async () => {
    const current = fixture();
    const pending = Promise.withResolvers<ReturnType<typeof board>>();
    current.client.getBoard.mockReturnValueOnce(pending.promise);
    current.client.editBoard.mockResolvedValueOnce(board(firstId, 1));
    await current.session.establish(issued());
    const read = current.coordinator.open({ workspaceId, projectId, boardId: firstId });
    const mutation = await current.coordinator.edit({ workspaceId, projectId, boardId: firstId, expectedVersion: 0, name: 'Changed' });
    pending.resolve(board(firstId, 0));
    const stale = await read;
    expect(stale.key.boardGeneration).toBe(0);
    expect(mutation.key.boardGeneration).toBe(1);
  });

  it('routes every mutation and work item read with generation fencing', async () => {
    const current = fixture();
    const changed = board(firstId, 1);
    const item = { workItemId: recentId, projectId, title: 'Task', description: '', lifecycle: 'OPEN' as const, version: 0, createdAt: now, updatedAt: now };
    current.client.createBoard.mockResolvedValue(changed);
    current.client.createColumn.mockResolvedValue(changed);
    current.client.editColumn.mockResolvedValue(changed);
    current.client.reorderColumns.mockResolvedValue(changed);
    current.client.moveCard.mockResolvedValue(changed);
    current.client.deleteColumn.mockResolvedValue(undefined);
    current.client.createWorkItem.mockResolvedValue({ workItem: item, board: changed });
    current.client.getWorkItem.mockResolvedValue(item);
    current.client.editWorkItem.mockResolvedValue({ workItem: { ...item, version: 1 }, board: changed });
    await current.session.establish(issued());
    const location = { workspaceId, projectId, boardId: firstId };

    await expect(current.coordinator.create({ workspaceId, projectId, requestId: recentId, name: 'Board', locale: 'en' })).resolves.toMatchObject({ key: { boardGeneration: 1 } });
    await expect(current.coordinator.createColumn({ ...location, requestId: recentId, expectedBoardVersion: 0, name: 'Done' })).resolves.toMatchObject({ key: { boardGeneration: 2 } });
    await expect(current.coordinator.editColumn({ ...location, columnId, expectedBoardVersion: 1, expectedColumnVersion: 0, name: 'Ready' })).resolves.toMatchObject({ key: { boardGeneration: 3 } });
    await expect(current.coordinator.reorderColumns({ ...location, expectedBoardVersion: 1, columnIds: [columnId] })).resolves.toMatchObject({ key: { boardGeneration: 4 } });
    await expect(current.coordinator.deleteColumn({ ...location, columnId, expectedBoardVersion: 1, expectedColumnVersion: 0 })).resolves.toMatchObject({ key: { boardGeneration: 5 } });
    await expect(current.coordinator.createWorkItem({ ...location, columnId, requestId: recentId, expectedBoardVersion: 1, title: 'Task' })).resolves.toMatchObject({ key: { boardGeneration: 6 } });
    await expect(current.coordinator.openWorkItem({ workspaceId, projectId, workItemId: recentId })).resolves.toMatchObject({ value: item });
    await expect(current.coordinator.editWorkItem({
      ...location,
      workItemId: recentId,
      currentColumnId: columnId,
      targetColumnId: columnId,
      expectedBoardVersion: 1,
      expectedPlacementVersion: 0,
      expectedVersion: 0,
      title: 'Changed',
    })).resolves.toMatchObject({ key: { boardGeneration: 7 } });
    await expect(current.coordinator.moveCard({ ...location, workItemId: recentId, expectedBoardVersion: 1, expectedPlacementVersion: 0, targetColumnId: columnId })).resolves.toMatchObject({ key: { boardGeneration: 8 } });
  });

  it('drops late responses after logout or account switch and isolates preferences', async () => {
    const current = fixture();
    const pending = Promise.withResolvers<ReturnType<typeof summary>[]>();
    current.client.listBoards.mockReturnValueOnce(pending.promise);
    await current.session.establish(issued(userA, 'a'));
    const late = current.coordinator.resolveHome({ workspaceId, projectId });
    await current.session.logout();
    await current.session.establish(issued(userB, 'b'));
    pending.resolve([summary(firstId)]);
    await expect(late).rejects.toMatchObject({ code: 'SESSION_CONTEXT_SUPERSEDED' });
    await expect(current.preferences.load('production', userB.userId, workspaceId, projectId)).resolves.toBeUndefined();
  });

  it('keeps only the newest selection preference when Board responses arrive out of order', async () => {
    const current = fixture();
    const older = Promise.withResolvers<ReturnType<typeof board>>();
    const latest = Promise.withResolvers<ReturnType<typeof board>>();
    current.client.getBoard.mockImplementation((_token, input) => input.boardId === firstId ? older.promise : latest.promise);
    await current.session.establish(issued());
    const first = current.coordinator.open({ workspaceId, projectId, boardId: firstId });
    const second = current.coordinator.open({ workspaceId, projectId, boardId: recentId });
    latest.resolve(board(recentId)); await second;
    older.resolve(board(firstId)); await first;
    await expect(current.preferences.load('production', userA.userId, workspaceId, projectId)).resolves.toBe(recentId);
  });
});
