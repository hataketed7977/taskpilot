import { describe, expect, it, vi } from 'vitest';
import { CHANNELS, registerDesktopHandlers } from '../../../src/main/ipc.js';

const trusted = { sender: { id: 7 }, senderFrame: { url: 'file:///app/index.html', parent: null } };
function setup(auth: Record<string, unknown>) {
  const handlers = new Map<string, (event: typeof trusted, input?: unknown) => unknown>();
  registerDesktopHandlers(
    { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
    { auth, workspaces: { list: vi.fn() }, projects: { resolveHome: vi.fn(), list: vi.fn(), open: vi.fn(), create: vi.fn(), edit: vi.fn(), archive: vi.fn(), restore: vi.fn(), permanentlyDelete: vi.fn() } } as never,
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
      cancelGitHubSignIn: vi.fn(), getSessionView: vi.fn(), logout: vi.fn(),
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
