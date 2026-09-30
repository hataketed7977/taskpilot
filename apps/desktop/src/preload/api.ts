import type { DesktopResult, SessionView, TaskPilotDesktopApi } from '../shared/contracts.js';
import { unwrapDesktopResult } from '../main/ipc-result.js';
import { CHANNELS } from '../main/ipc.js';

export type DesktopInvoke = (channel: string, input?: unknown) => Promise<unknown>;
export type SessionSubscription = (listener: (view: SessionView) => void) => () => void;

export function createTaskPilotDesktopApi(invoke: DesktopInvoke, subscribe: SessionSubscription): TaskPilotDesktopApi {
  const call = async <T>(channel: string, input?: unknown): Promise<T> => unwrapDesktopResult(await invoke(channel, input) as DesktopResult<T>);
  return {
    auth: {
      signInWithPassword: input => call(CHANNELS.signInWithPassword, input), requestLoginCode: input => call(CHANNELS.requestLoginCode, input),
      verifyLoginCode: input => call(CHANNELS.verifyLoginCode, input), requestRegistrationCode: input => call(CHANNELS.requestRegistrationCode, input),
      verifyRegistrationCode: input => call(CHANNELS.verifyRegistrationCode, input), register: input => call(CHANNELS.register, input),
      requestPasswordResetCode: input => call(CHANNELS.requestPasswordResetCode, input), verifyPasswordResetCode: input => call(CHANNELS.verifyPasswordResetCode, input),
      resetPassword: input => call(CHANNELS.resetPassword, input), getSessionView: () => call(CHANNELS.getSessionView),
      subscribeSessionView: subscribe,
      logout: () => call(CHANNELS.logout),
    },
    workspaces: {
      listWorkspaces: () => call(CHANNELS.listWorkspaces), createWorkspace: input => call(CHANNELS.createWorkspace, input),
      restoreActiveWorkspace: input => call(CHANNELS.restoreActiveWorkspace, input), selectWorkspace: input => call(CHANNELS.selectWorkspace, input),
      clearActiveWorkspace: () => call(CHANNELS.clearActiveWorkspace),
    },
    projects: { listProjects: input => call(CHANNELS.listProjects, input) },
  };
}
