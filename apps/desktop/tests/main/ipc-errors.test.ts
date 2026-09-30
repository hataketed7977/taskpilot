import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OutcomeUnknownError, TransportError } from '../../src/main/api/transport.js';
import { toDesktopError, unwrapDesktopResult } from '../../src/main/ipc-result.js';
import { CHANNELS, registerDesktopHandlers } from '../../src/main/ipc.js';

const trusted = { sender: { id: 7 }, senderFrame: { url: 'file:///app/index.html', parent: null } };

describe('serializable IPC result contract', () => {
  it('preserves only the stable Desktop error fields', () => {
    const source = new TransportError({
      code: 'RATE_LIMITED', category: 'temporary', path: 'email', retryAfterSeconds: 20, recovery: 'RETRY',
    }, 429);
    expect(toDesktopError(source)).toEqual({
      code: 'RATE_LIMITED', category: 'temporary', path: 'email', retryAfterSeconds: 20, recovery: 'RETRY',
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
    const owner = { signInWithPassword: vi.fn() };
    registerDesktopHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: vi.fn() },
      { auth: owner, workspaces: {}, projects: {} } as never,
      { webContentsId: 7, generation: 1 },
    );
    await expect(handlers.get(CHANNELS.signInWithPassword)!(trusted, { email: 'bad', password: '' })).resolves.toEqual({
      ok: false, error: { code: 'IPC_INPUT_INVALID', category: 'validation' },
    });
    expect(owner.signInWithPassword).not.toHaveBeenCalled();
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
