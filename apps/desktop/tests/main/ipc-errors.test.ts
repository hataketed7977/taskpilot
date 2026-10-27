import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OutcomeUnknownError, TransportError } from '../../src/main/api/transport.js';
import { toDesktopError, unwrapDesktopResult } from '../../src/main/ipc-result.js';
import { CHANNELS, registerDesktopHandlers } from '../../src/main/ipc.js';

const trusted = { sender: { id: 7 }, senderFrame: { url: 'file:///app/index.html', parent: null } };

describe('serializable IPC result contract', () => {
  it('preserves only the stable Desktop error fields', () => {
    const source = new TransportError({
      code: 'RATE_LIMITED', category: 'temporary', path: 'displayName', retryAfterSeconds: 20, recovery: 'RETRY',
    }, 429);
    expect(toDesktopError(source)).toEqual({
      code: 'RATE_LIMITED', category: 'temporary', path: 'displayName', retryAfterSeconds: 20, recovery: 'RETRY',
    });
    expect(toDesktopError(new OutcomeUnknownError())).toEqual({ code: 'REQUEST_RESULT_UNKNOWN', category: 'unknown', recovery: 'RETRY' });
    expect(toDesktopError(new TypeError('offline and possibly secret'))).toEqual({ code: 'NETWORK_UNAVAILABLE', category: 'temporary', recovery: 'RETRY' });
    expect(toDesktopError(new Error('access-secret'))).toEqual({ code: 'UNEXPECTED_DESKTOP_ERROR', category: 'unknown' });
  });

  it('maps schema failures without returning values or raw diagnostics', () => {
    expect(toDesktopError(new z.ZodError([]))).toEqual({ code: 'IPC_INPUT_INVALID', category: 'validation' });
  });

  it('returns an error envelope for invalid input and never calls the owner', async () => {
    const handlers = new Map<string, (event: typeof trusted, input?: unknown) => unknown>();
    const owner = { completeGitHubRegistration: vi.fn() };
    registerDesktopHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
      { auth: owner, workspaces: {}, projects: {} } as never,
      { webContentsId: 7, generation: 1 },
    );
    await expect(handlers.get(CHANNELS.completeGitHubRegistration)!(trusted, { flowId: 'bad', displayName: '', useSuggestedAvatar: true, termsVersion: '' })).resolves.toEqual({
      ok: false, error: { code: 'IPC_INPUT_INVALID', category: 'validation' },
    });
    expect(owner.completeGitHubRegistration).not.toHaveBeenCalled();
  });

  it('validates and invokes only the fixed permanent Board deletion capability', async () => {
    const handlers = new Map<string, (event: typeof trusted, input?: unknown) => unknown>();
    const permanentlyDelete = vi.fn().mockResolvedValue({ outcome: 'deleted', home: { boards: [] } });
    registerDesktopHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
      { auth: {}, workspaces: {}, projects: {}, boards: { permanentlyDelete } } as never,
      { webContentsId: 7, generation: 1 },
    );
    const input = {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      boardId: '33333333-3333-4333-8333-333333333333',
      expectedVersion: 0,
      confirmationName: 'Delivery',
    };

    await expect(handlers.get(CHANNELS.permanentlyDeleteBoard)!(trusted, input)).resolves.toMatchObject({
      ok: true, value: { outcome: 'deleted', home: { boards: [] } },
    });
    await expect(handlers.get(CHANNELS.permanentlyDeleteBoard)!(trusted, { ...input, expectedVersion: -1 })).resolves.toEqual({
      ok: false, error: { code: 'IPC_INPUT_INVALID', category: 'validation' },
    });
    expect(permanentlyDelete).toHaveBeenCalledTimes(1);
    expect(permanentlyDelete).toHaveBeenCalledWith(input);
  });

  it('requires layout versions only when a Work Item changes Column', async () => {
    const handlers = new Map<string, (event: typeof trusted, input?: unknown) => unknown>();
    const owner = { editWorkItem: vi.fn().mockResolvedValue({}) };
    registerDesktopHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
      { auth: {}, workspaces: {}, projects: {}, boards: owner } as never,
      { webContentsId: 7, generation: 1 },
    );
    const location = {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      boardId: '33333333-3333-4333-8333-333333333333',
      workItemId: '44444444-4444-4444-8444-444444444444',
      currentColumnId: '55555555-5555-4555-8555-555555555555',
      expectedVersion: 0,
      title: 'Task',
    };
    const handler = handlers.get(CHANNELS.editWorkItem)!;

    await expect(handler(trusted, { ...location, targetColumnId: location.currentColumnId })).resolves.toMatchObject({ ok: true });
    await expect(handler(trusted, {
      ...location,
      targetColumnId: '66666666-6666-4666-8666-666666666666',
      expectedPlacementVersion: 0,
    })).resolves.toEqual({ ok: false, error: { code: 'IPC_INPUT_INVALID', category: 'validation' } });
    await expect(handler(trusted, {
      ...location,
      targetColumnId: '66666666-6666-4666-8666-666666666666',
      expectedBoardVersion: 1,
    })).resolves.toEqual({ ok: false, error: { code: 'IPC_INPUT_INVALID', category: 'validation' } });
    expect(owner.editWorkItem).toHaveBeenCalledTimes(1);
  });

  it('unwraps values and rejects with only the plain error union', () => {
    expect(unwrapDesktopResult({ ok: true, value: { status: 'signedOut' as const } })).toEqual({ status: 'signedOut' });
    expect(() => unwrapDesktopResult({ ok: false, error: { code: 'AUTHENTICATION_REQUIRED', category: 'authentication', recovery: 'SIGN_IN' } })).toThrow();
    try {
      unwrapDesktopResult({ ok: false, error: { code: 'AUTHENTICATION_REQUIRED', category: 'authentication', recovery: 'SIGN_IN' } });
    } catch (error) {
      expect(error).toEqual({ code: 'AUTHENTICATION_REQUIRED', category: 'authentication', recovery: 'SIGN_IN' });
      expect(error).not.toBeInstanceOf(Error);
    }
  });
});
