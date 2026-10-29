import { describe, expect, it, vi } from 'vitest';
import type { HttpTransport } from '../../../src/main/api/transport.js';
import { ProjectWorkClient } from '../../../src/main/projects/project-work-client.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const boardId = '33333333-3333-4333-8333-333333333333';
const columnId = '44444444-4444-4444-8444-444444444444';
const workItemId = '55555555-5555-4555-8555-555555555555';
const requestId = '66666666-6666-4666-8666-666666666666';
const now = '2030-01-01T00:00:00Z';
const board = {
  boardId, projectId, name: 'Board', description: '', version: 0, createdAt: now, updatedAt: now,
  columns: [{ columnId, name: 'To do', position: 0, version: 0, createdAt: now, updatedAt: now, cards: [] }],
};
const workItem = { workItemId, projectId, title: 'Ship it', description: '', version: 0, createdAt: now, updatedAt: now };

describe('ProjectWorkClient', () => {
  it('uses the fixed Project Work routes and request shapes', async () => {
    const request = vi.fn(async input => {
      if (input.method === 'GET' && input.path.endsWith('/boards')) return [{ boardId, projectId, name: 'Board', description: '', version: 0, createdAt: now, updatedAt: now }];
      if (input.method === 'DELETE') return undefined;
      if (input.path.endsWith('/work-items') && input.method === 'POST') return { workItem, board };
      if (input.path.includes('/work-items/') && input.method === 'PATCH') return { workItem, board };
      if (input.path.includes('/work-items/')) return workItem;
      return board;
    });
    const client = new ProjectWorkClient({ request } as HttpTransport);
    const project = { workspaceId, projectId };
    const location = { ...project, boardId };
    const token = 'access-secret';

    await client.listBoards(token, project);
    await client.getBoard(token, location);
    await client.createBoard(token, { ...project, requestId, name: 'Delivery', locale: 'en' });
    await client.editBoard(token, { ...location, expectedVersion: 0, name: 'Delivery', description: 'Now' });
    await client.permanentlyDeleteBoard(token, { ...location, expectedVersion: 0, confirmationName: 'Delivery' });
    await client.createColumn(token, { ...location, requestId, expectedBoardVersion: 1, name: 'Done' });
    await client.editColumn(token, { ...location, columnId, expectedBoardVersion: 2, expectedColumnVersion: 0, name: 'Ready' });
    await client.reorderColumns(token, { ...location, expectedBoardVersion: 3, columnIds: [columnId] });
    await client.deleteColumn(token, { ...location, columnId, expectedBoardVersion: 4, expectedColumnVersion: 1 });
    await client.createWorkItem(token, { ...location, columnId, requestId, expectedBoardVersion: 4, title: 'Ship it' });
    await client.getWorkItem(token, { ...location, workItemId });
    await client.editWorkItem(token, {
      ...project,
      boardId,
      workItemId,
      currentColumnId: columnId,
      targetColumnId: columnId,
      expectedVersion: 0,
      title: 'Ship now',
    });
    await client.moveCard(token, { ...location, workItemId, expectedBoardVersion: 5, expectedPlacementVersion: 0, targetColumnId: columnId });

    const root = `/desktop/v1/workspaces/${workspaceId}/projects/${projectId}`;
    expect(request.mock.calls.map(([value]) => `${value.method} ${value.path}`)).toEqual([
      `GET ${root}/boards`, `GET ${root}/boards/${boardId}`, `POST ${root}/boards`, `PATCH ${root}/boards/${boardId}`,
      `POST ${root}/boards/${boardId}/permanent-deletion`, `POST ${root}/boards/${boardId}/columns`, `PATCH ${root}/boards/${boardId}/columns/${columnId}`,
      `PUT ${root}/boards/${boardId}/column-order`,
      `DELETE ${root}/boards/${boardId}/columns/${columnId}?expectedBoardVersion=4&expectedColumnVersion=1`,
      `POST ${root}/boards/${boardId}/work-items`, `GET ${root}/work-items/${workItemId}`,
      `PATCH ${root}/work-items/${workItemId}`, `POST ${root}/boards/${boardId}/placements/${workItemId}/move`,
    ]);
    expect(request.mock.calls[2]?.[0]).toMatchObject({ accessToken: token, body: { requestId, name: 'Delivery', locale: 'en' } });
    expect(request.mock.calls[4]?.[0]).toMatchObject({
      accessToken: token,
      body: { expectedVersion: 0, confirmationName: 'Delivery' },
      outcomeUnknownOnNetworkFailure: true,
    });
    expect(request.mock.calls[11]?.[0].body).toEqual({
      boardId,
      currentColumnId: columnId,
      targetColumnId: columnId,
      expectedVersion: 0,
      title: 'Ship now',
      description: undefined,
    });
  });

  it('sends layout versions for a cross-column atomic edit', async () => {
    const targetColumnId = '77777777-7777-4777-8777-777777777777';
    const request = vi.fn().mockResolvedValue({ workItem, board });
    const client = new ProjectWorkClient({ request } as HttpTransport);

    await client.editWorkItem('access-secret', {
      workspaceId,
      projectId,
      boardId,
      workItemId,
      currentColumnId: columnId,
      targetColumnId,
      expectedBoardVersion: 5,
      expectedPlacementVersion: 2,
      expectedVersion: 1,
      title: 'Move it',
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      body: {
        boardId,
        currentColumnId: columnId,
        targetColumnId,
        expectedBoardVersion: 5,
        expectedPlacementVersion: 2,
        expectedVersion: 1,
        title: 'Move it',
        description: undefined,
      },
    }));
  });

  it('accepts current exact Work Item and Card shapes', async () => {
    const card = { workItemId, title: workItem.title, description: '', workItemVersion: 0, placementVersion: 0, position: 0 };
    const responseBoard = { ...board, columns: [{ ...board.columns[0], cards: [card] }] };
    const request = vi.fn().mockResolvedValueOnce(workItem).mockResolvedValueOnce(responseBoard);
    const client = new ProjectWorkClient({ request } as HttpTransport);
    expect(await client.getWorkItem('token', { workspaceId, projectId, boardId, workItemId })).toEqual(workItem);
    expect(await client.getBoard('token', { workspaceId, projectId, boardId })).toEqual(responseBoard);
  });

  it.each(['lifecycle', 'status'])('fails closed on old %s in Work Item and Card responses', async field => {
    const legacyItem = { ...workItem, [field]: 'OPEN' };
    const legacyCard = { workItemId, title: workItem.title, description: '', workItemVersion: 0, placementVersion: 0, position: 0, [field]: 'OPEN' };
    const legacyBoard = { ...board, columns: [{ ...board.columns[0], cards: [legacyCard] }] };
    const request = vi.fn().mockResolvedValueOnce(legacyItem).mockResolvedValueOnce(legacyBoard);
    const client = new ProjectWorkClient({ request } as HttpTransport);
    await expect(client.getWorkItem('token', { workspaceId, projectId, boardId, workItemId })).rejects.toThrow();
    await expect(client.getBoard('token', { workspaceId, projectId, boardId })).rejects.toThrow();
  });

  it('rejects malformed responses including copied Card identity', async () => {
    const malformed = { ...board, columns: [{ ...board.columns[0], cards: [{ cardId: workItemId }] }] };
    const client = new ProjectWorkClient({ request: vi.fn().mockResolvedValue(malformed) } as HttpTransport);
    await expect(client.getBoard('token', { workspaceId, projectId, boardId })).rejects.toThrow();
  });
});
