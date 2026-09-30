import { describe, expect, it, vi } from 'vitest';
import { CHANNELS, registerDesktopHandlers } from '../../src/main/ipc.js';

const trusted = { sender: { id: 7 }, senderFrame: { url: 'file:///app/index.html', parent: null } };

describe('validated Desktop IPC inputs', () => {
  it('rejects malformed input before invoking the owner', async () => {
    const handlers = new Map<string, (event: typeof trusted, input?: unknown) => unknown>();
    const owner = { signInWithPassword: vi.fn() };
    registerDesktopHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
      { auth: owner, workspaces: {}, projects: {} } as never,
      { webContentsId: 7, generation: 1 },
    );
    await expect(handlers.get(CHANNELS.signInWithPassword)!(trusted, { email: 'not-email', password: '' })).resolves.toEqual({ ok: false, error: { code: 'IPC_INPUT_INVALID', category: 'validation' } });
    expect(owner.signInWithPassword).not.toHaveBeenCalled();
  });

  it('binds every registered channel to its own schema and capability', async () => {
    const handlers = new Map<string, (event: typeof trusted, input?: unknown) => unknown>();
    const listWorkspaces = vi.fn().mockResolvedValue({ items: [], capabilities: { canCreateWorkspace: true } });
    const listProjects = vi.fn().mockResolvedValue({ items: [] });
    registerDesktopHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
      { auth: {}, workspaces: { listWorkspaces }, projects: { listProjects } } as never,
      { webContentsId: 7, generation: 1 },
    );

    await expect(handlers.get(CHANNELS.listWorkspaces)!(trusted)).resolves.toEqual({
      ok: true, value: { items: [], capabilities: { canCreateWorkspace: true } },
    });
    expect(listWorkspaces).toHaveBeenCalledOnce();
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('accepts only the narrow Workspace and Project inputs', async () => {
    const handlers = new Map<string, (event: typeof trusted, input?: unknown) => unknown>();
    const createWorkspace = vi.fn().mockResolvedValue({});
    const listProjects = vi.fn().mockResolvedValue({ items: [] });
    registerDesktopHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
      { auth: {}, workspaces: { createWorkspace }, projects: { listProjects } } as never,
      { webContentsId: 7, generation: 1 },
    );
    await expect(handlers.get(CHANNELS.createWorkspace)!(trusted, { name: 'North', creationRequestId: 'bad', role: 'ADMIN' })).resolves.toEqual({ ok: false, error: { code: 'IPC_INPUT_INVALID', category: 'validation' } });
    await expect(handlers.get(CHANNELS.listProjects)!(trusted, { workspaceId: 'bad', limit: 101 })).resolves.toEqual({ ok: false, error: { code: 'IPC_INPUT_INVALID', category: 'validation' } });
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
  });
});
