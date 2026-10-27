import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonRecentBoardStore, MemoryRecentBoardStore } from '../../src/main/projects/recent-board-store.js';

const userId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const otherWorkspaceId = '33333333-3333-4333-8333-333333333333';
const projectId = '44444444-4444-4444-8444-444444444444';
const otherProjectId = '55555555-5555-4555-8555-555555555555';
const boardId = '66666666-6666-4666-8666-666666666666';

describe.each([
  ['memory', () => new MemoryRecentBoardStore()],
  ['json', async () => new JsonRecentBoardStore(join(await mkdtemp(join(tmpdir(), 'taskpilot-board-')), 'recent.json'))],
])('RecentBoardStore %s', (_name, create) => {
  it('isolates preferences by environment, User, Workspace and Project', async () => {
    const store = await create();
    await store.save('production', userId, workspaceId, projectId, boardId);
    await expect(store.load('production', userId, workspaceId, projectId)).resolves.toBe(boardId);
    await expect(store.load('local', userId, workspaceId, projectId)).resolves.toBeUndefined();
    await expect(store.load('production', userId, otherWorkspaceId, projectId)).resolves.toBeUndefined();
    await expect(store.load('production', userId, workspaceId, otherProjectId)).resolves.toBeUndefined();
    await store.clear('production', userId, workspaceId, projectId);
    await expect(store.load('production', userId, workspaceId, projectId)).resolves.toBeUndefined();
  });
});

describe('JsonRecentBoardStore', () => {
  it('serializes a clear after an earlier save so a deleted Board cannot be restored', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'taskpilot-board-order-'));
    const store = new JsonRecentBoardStore(join(directory, 'recent.json'));
    const save = store.save('production', userId, workspaceId, projectId, boardId);
    const clear = store.clear('production', userId, workspaceId, projectId);
    await Promise.all([save, clear]);
    await expect(store.load('production', userId, workspaceId, projectId)).resolves.toBeUndefined();
  });

  it('recovers from an invalid document and persists a versioned document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'taskpilot-board-invalid-'));
    const path = join(directory, 'recent.json');
    const store = new JsonRecentBoardStore(path);
    await store.save('local', userId, workspaceId, projectId, boardId);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1 });
  });
});
