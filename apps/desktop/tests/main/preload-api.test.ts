import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc.js';
import { createTaskPilotDesktopApi } from '../../src/preload/api.js';
import type { SessionView } from '../../src/shared/contracts.js';

const success = { ok: true as const, value: undefined };

describe('createTaskPilotDesktopApi', () => {
  it('maps every narrow capability to its fixed IPC channel and preserves inputs', async () => {
    const invoke = vi.fn().mockResolvedValue(success);
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: (view: SessionView) => void) => {
      expect(listener).toBeTypeOf('function');
      return unsubscribe;
    });
    const api = createTaskPilotDesktopApi(invoke, subscribe);
    const cases: Array<[() => Promise<unknown>, string, unknown?]> = [
      [() => api.auth.signInWithPassword({ email: 'a@example.com', password: 'secret' }), CHANNELS.signInWithPassword, { email: 'a@example.com', password: 'secret' }],
      [() => api.auth.requestLoginCode({ email: 'a@example.com' }), CHANNELS.requestLoginCode, { email: 'a@example.com' }],
      [() => api.auth.verifyLoginCode({ challengeId: 'c', email: 'a@example.com', code: '123456' }), CHANNELS.verifyLoginCode, { challengeId: 'c', email: 'a@example.com', code: '123456' }],
      [() => api.auth.requestRegistrationCode({ email: 'a@example.com' }), CHANNELS.requestRegistrationCode, { email: 'a@example.com' }],
      [() => api.auth.verifyRegistrationCode({ challengeId: 'c', email: 'a@example.com', code: '123456' }), CHANNELS.verifyRegistrationCode, { challengeId: 'c', email: 'a@example.com', code: '123456' }],
      [() => api.auth.register({ flowHandle: 'f', email: 'a@example.com', displayName: 'A', password: 'secret', termsVersion: 'v1' }), CHANNELS.register, { flowHandle: 'f', email: 'a@example.com', displayName: 'A', password: 'secret', termsVersion: 'v1' }],
      [() => api.auth.requestPasswordResetCode({ email: 'a@example.com' }), CHANNELS.requestPasswordResetCode, { email: 'a@example.com' }],
      [() => api.auth.verifyPasswordResetCode({ challengeId: 'c', email: 'a@example.com', code: '123456' }), CHANNELS.verifyPasswordResetCode, { challengeId: 'c', email: 'a@example.com', code: '123456' }],
      [() => api.auth.resetPassword({ flowHandle: 'f', email: 'a@example.com', newPassword: 'new-secret' }), CHANNELS.resetPassword, { flowHandle: 'f', email: 'a@example.com', newPassword: 'new-secret' }],
      [() => api.auth.getSessionView(), CHANNELS.getSessionView],
      [() => api.auth.logout(), CHANNELS.logout],
      [() => api.workspaces.listWorkspaces(), CHANNELS.listWorkspaces],
      [() => api.workspaces.createWorkspace({ name: 'Acme', creationRequestId: 'r' }), CHANNELS.createWorkspace, { name: 'Acme', creationRequestId: 'r' }],
      [() => api.workspaces.restoreActiveWorkspace({ availableWorkspaceIds: ['w'] }), CHANNELS.restoreActiveWorkspace, { availableWorkspaceIds: ['w'] }],
      [() => api.workspaces.selectWorkspace({ workspaceId: 'w' }), CHANNELS.selectWorkspace, { workspaceId: 'w' }],
      [() => api.workspaces.clearActiveWorkspace(), CHANNELS.clearActiveWorkspace],
      [() => api.projects.listProjects({ workspaceId: 'w', cursor: 'next', limit: 25 }), CHANNELS.listProjects, { workspaceId: 'w', cursor: 'next', limit: 25 }],
    ];

    for (const [call, channel, input] of cases) {
      invoke.mockClear();
      await expect(call()).resolves.toBeUndefined();
      expect(invoke).toHaveBeenCalledWith(channel, input);
    }

    const listener = vi.fn();
    expect(api.auth.subscribeSessionView(listener)).toBe(unsubscribe);
    expect(subscribe).toHaveBeenCalledWith(listener);
  });

  it('unwraps successful values and rejects stable error envelopes', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { status: 'signedOut' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'SESSION_EXPIRED', category: 'authentication', recovery: 'SIGN_IN' } });
    const api = createTaskPilotDesktopApi(invoke, () => vi.fn());

    await expect(api.auth.getSessionView()).resolves.toEqual({ status: 'signedOut' });
    await expect(api.auth.logout()).rejects.toEqual({
      code: 'SESSION_EXPIRED',
      category: 'authentication',
      recovery: 'SIGN_IN',
    });
  });
});
