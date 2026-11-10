import { describe, expect, it, vi } from 'vitest';
import { CHANNELS, registerDesktopHandlers } from '../../../src/main/ipc.js';

const trusted = { sender: { id: 7 }, senderFrame: { url: 'file:///app/index.html', parent: null } };
const uuid = '11111111-1111-4111-8111-111111111111';

function setup(auth: Record<string, unknown>, boards: Record<string, unknown> = {}) {
  const handlers = new Map<string, (event: typeof trusted, input?: unknown) => unknown>();
  registerDesktopHandlers(
    { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
    {
      auth,
      workspaces: { list: vi.fn() },
      projects: { resolveHome: vi.fn(), list: vi.fn(), open: vi.fn(), create: vi.fn(), edit: vi.fn(), archive: vi.fn(), restore: vi.fn(), permanentlyDelete: vi.fn() },
      boards,
    } as never,
    { webContentsId: 7, generation: 1 },
  );
  return handlers;
}

describe('validated Desktop IPC inputs', () => {
  it('rejects malformed registration input before invoking the owner', async () => {
    const completeGitHubRegistration = vi.fn();
    const handlers = setup({ completeGitHubRegistration });
    await expect(handlers.get(CHANNELS.completeGitHubRegistration)!(trusted, {
      flowId: 'bad', displayName: '', useSuggestedAvatar: true, termsVersion: '', extra: true,
    })).resolves.toEqual({ ok: false, error: { code: 'IPC_INPUT_INVALID', category: 'validation' } });
    expect(completeGitHubRegistration).not.toHaveBeenCalled();
  });

  it('binds every Auth channel to its corresponding owner method', async () => {
    const methods = {
      getCapabilities: vi.fn().mockResolvedValue({ github: { enabled: true } }),
      startGitHubSignIn: vi.fn(), continueGitHubSignIn: vi.fn(), completeGitHubRegistration: vi.fn(),
      cancelGitHubSignIn: vi.fn(), retrySessionRestore: vi.fn().mockResolvedValue({ status: 'signedOut' }), getSessionView: vi.fn(), logout: vi.fn(),
    };
    const handlers = setup(methods);
    expect([...handlers.keys()].sort()).toEqual(Object.values(CHANNELS).filter(channel => channel !== CHANNELS.sessionChanged).sort());
    await expect(handlers.get(CHANNELS.getAuthCapabilities)!(trusted)).resolves.toEqual({
      ok: true, value: { github: { enabled: true } },
    });
    expect(methods.getCapabilities).toHaveBeenCalledOnce();
  });

  it('rejects malformed Project inputs before invoking the owner', async () => {
    const create = vi.fn();
    const handlers = new Map<string, (event: typeof trusted, input?: unknown) => unknown>();
    registerDesktopHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
      { auth: {}, workspaces: { list: vi.fn() }, projects: { create } } as never,
      { webContentsId: 7, generation: 1 },
    );
    await expect(handlers.get(CHANNELS.createProject)!(trusted, {
      workspaceId: 'bad', requestId: 'bad', name: 'x'.repeat(201), extra: true,
    })).resolves.toMatchObject({ ok: false, error: { code: 'IPC_INPUT_INVALID', category: 'validation' } });
    expect(create).not.toHaveBeenCalled();
  });



  it('enforces sparse non-null mutation envelopes before invoking owners', async () => {
    const editProject = vi.fn().mockResolvedValue({});
    const editBoard = vi.fn().mockResolvedValue({});
    const editWorkItem = vi.fn().mockResolvedValue({});
    const handlers = new Map<string, (event: typeof trusted, input?: unknown) => unknown>();
    registerDesktopHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
      {
        auth: {},
        workspaces: { list: vi.fn() },
        projects: { edit: editProject },
        boards: { edit: editBoard, editWorkItem },
      } as never,
      { webContentsId: 7, generation: 1 },
    );
    const project = { workspaceId: uuid, projectId: uuid };
    const board = { ...project, boardId: uuid };
    const workItem = {
      ...board,
      workItemId: uuid,
      currentColumnId: uuid,
      targetColumnId: uuid,
      expectedVersion: 0,
    };

    await expect(handlers.get(CHANNELS.editProject)!(trusted, {
      ...project,
      expectedVersion: 0,
      descriptionPatch: { action: 'CLEAR' },
    })).resolves.toMatchObject({ ok: true });
    await expect(handlers.get(CHANNELS.editBoard)!(trusted, {
      ...board,
      expectedVersion: 0,
      descriptionPatch: { action: 'SET', value: 'Notes' },
    })).resolves.toMatchObject({ ok: true });
    await expect(handlers.get(CHANNELS.editWorkItem)!(trusted, {
      ...workItem,
      assigneePatch: { action: 'CLEAR' },
    })).resolves.toMatchObject({ ok: true });

    const invalid: Array<[string, unknown]> = [
      [CHANNELS.editProject, { ...project, expectedVersion: 0 }],
      [CHANNELS.editProject, { ...project, expectedVersion: 0, name: null }],
      [CHANNELS.editBoard, { ...board, expectedVersion: 0, descriptionPatch: null }],
      [CHANNELS.editBoard, { ...board, expectedVersion: 0, descriptionPatch: { action: 'SET', value: null } }],
      [CHANNELS.editBoard, { ...board, expectedVersion: 0, descriptionPatch: { action: 'CLEAR', value: 'unexpected' } }],
      [CHANNELS.editWorkItem, { ...workItem, title: null, assigneePatch: { action: 'CLEAR' } }],
      [CHANNELS.editWorkItem, { ...workItem, descriptionPatch: { action: 'SET', value: '' } }],
      [CHANNELS.editWorkItem, { ...workItem, assigneePatch: null }],
      [CHANNELS.editWorkItem, workItem],
    ];
    for (const [channel, input] of invalid) {
      await expect(handlers.get(channel)!(trusted, input)).resolves.toMatchObject({
        ok: false,
        error: { code: 'IPC_INPUT_INVALID', category: 'validation' },
      });
    }

    expect(editProject).toHaveBeenCalledTimes(1);
    expect(editBoard).toHaveBeenCalledTimes(1);
    expect(editWorkItem).toHaveBeenCalledTimes(1);
  });

  it('accepts only Project Member assignee shapes for Work Item create and edit', async () => {
    const createWorkItem = vi.fn().mockResolvedValue({});
    const editWorkItem = vi.fn().mockResolvedValue({});
    const handlers = setup({}, { createWorkItem, editWorkItem });
    const location = { workspaceId: uuid, projectId: uuid, boardId: uuid };

    await expect(handlers.get(CHANNELS.createWorkItem)!(trusted, {
      ...location,
      columnId: uuid,
      requestId: uuid,
      expectedBoardVersion: 1,
      title: 'Task',
      assignee: { targetType: 'PROJECT_MEMBER', projectMemberId: uuid },
    })).resolves.toMatchObject({ ok: true });
    await expect(handlers.get(CHANNELS.editWorkItem)!(trusted, {
      ...location,
      workItemId: uuid,
      currentColumnId: uuid,
      targetColumnId: uuid,
      expectedVersion: 0,
      title: 'Task',
      assigneePatch: { action: 'CLEAR' },
    })).resolves.toMatchObject({ ok: true });
    await expect(handlers.get(CHANNELS.editWorkItem)!(trusted, {
      ...location,
      workItemId: uuid,
      currentColumnId: uuid,
      targetColumnId: uuid,
      expectedVersion: 1,
      title: 'Task',
      assigneePatch: { action: 'SET', target: { targetType: 'PROJECT_MEMBER', projectMemberId: uuid } },
    })).resolves.toMatchObject({ ok: true });

    await expect(handlers.get(CHANNELS.createWorkItem)!(trusted, {
      ...location,
      columnId: uuid,
      requestId: uuid,
      expectedBoardVersion: 1,
      title: 'Task',
      assignee: { targetType: 'PROJECT_AGENT_BINDING', projectAgentBindingId: uuid },
    })).resolves.toMatchObject({ ok: false, error: { category: 'validation' } });
    await expect(handlers.get(CHANNELS.editWorkItem)!(trusted, {
      ...location,
      workItemId: uuid,
      currentColumnId: uuid,
      targetColumnId: uuid,
      expectedVersion: 1,
      title: 'Task',
      assigneePatch: { action: 'CLEAR', target: { targetType: 'PROJECT_MEMBER', projectMemberId: uuid } },
    })).resolves.toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(createWorkItem).toHaveBeenCalledTimes(1);
    expect(editWorkItem).toHaveBeenCalledTimes(2);
  });

  it('accepts only UUID flow identifiers and strict objects', async () => {
    const continueGitHubSignIn = vi.fn().mockResolvedValue({ status: 'waiting' });
    const handlers = setup({ continueGitHubSignIn });
    await expect(handlers.get(CHANNELS.continueGitHubSignIn)!(trusted, {
      flowId: '11111111-1111-4111-8111-111111111111',
    })).resolves.toEqual({ ok: true, value: { status: 'waiting' } });
    await expect(handlers.get(CHANNELS.continueGitHubSignIn)!(trusted, {
      flowId: '11111111-1111-4111-8111-111111111111', extra: true,
    })).resolves.toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(continueGitHubSignIn).toHaveBeenCalledTimes(1);
  });
});

describe('bounded UTF-8 IPC request budget', () => {
  const location = { workspaceId: uuid, projectId: uuid, boardId: uuid };
  it.each(['😀'.repeat(5000), 'ᾂ'.normalize('NFD').repeat(5000)])('accepts complete maximum Unicode create and edit bodies', async (description) => {
    const createWorkItem = vi.fn().mockResolvedValue({});
    const editWorkItem = vi.fn().mockResolvedValue({});
    const handlers = setup({}, { createWorkItem, editWorkItem });
    const create = { ...location, columnId: uuid, requestId: uuid, expectedBoardVersion: 1, title: '😀'.repeat(160), description };
    const edit = { ...location, workItemId: uuid, currentColumnId: uuid, targetColumnId: uuid, expectedVersion: 0,
      expectedBoardVersion: 1, expectedPlacementVersion: 0, title: create.title, descriptionPatch: { action: 'SET', value: description } };
    for (const [channel, input] of [[CHANNELS.createWorkItem, create], [CHANNELS.editWorkItem, edit]] as const) {
      expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeLessThan(131072);
      await expect(handlers.get(channel)!(trusted, input)).resolves.toMatchObject({ ok: true });
    }
    expect(createWorkItem).toHaveBeenCalledOnce();
    expect(editWorkItem).toHaveBeenCalledOnce();
  });

  it('accepts exactly 128 KiB and rejects one byte more before the owner', async () => {
    const createWorkItem = vi.fn().mockResolvedValue({});
    const handlers = setup({}, { createWorkItem });
    const base = { ...location, columnId: uuid, requestId: uuid, expectedBoardVersion: 1, title: 'Task', description: '' };
    const overhead = new TextEncoder().encode(JSON.stringify(base)).length;
    const input = { ...base, description: ' '.repeat(131072 - overhead) };
    expect(new TextEncoder().encode(JSON.stringify(input)).length).toBe(131072);
    await expect(handlers.get(CHANNELS.createWorkItem)!(trusted, input)).resolves.toMatchObject({ ok: true });
    await expect(handlers.get(CHANNELS.createWorkItem)!(trusted, { ...input, description: input.description + ' ' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(createWorkItem).toHaveBeenCalledOnce();
  });

  it('keeps retry parameterless and rejects wrong senders before calling the owner', async () => {
    const retrySessionRestore = vi.fn().mockResolvedValue({ status: 'temporarilyUnavailable' });
    const handlers = setup({ retrySessionRestore });
    const handler = handlers.get(CHANNELS.retrySessionRestore)!;
    await expect(handler(trusted, {})).resolves.toMatchObject({ ok: false });
    await expect(handler({ ...trusted, sender: { id: 9 } })).resolves.toMatchObject({ ok: false });
    expect(retrySessionRestore).not.toHaveBeenCalled();
    await expect(handler(trusted)).resolves.toEqual({ ok: true, value: { status: 'temporarilyUnavailable' } });
  });
});
