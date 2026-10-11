import type { DesktopResult, SessionView, TaskPilotDesktopApi } from '../shared/contracts.js';
import { unwrapDesktopResult } from '../main/ipc-result.js';
import { CHANNELS } from '../main/ipc.js';
export type DesktopInvoke = (channel: string, input?: unknown) => Promise<unknown>;
export type SessionSubscription = (listener: (view: SessionView) => void) => () => void;
export function createTaskPilotDesktopApi(invoke: DesktopInvoke, subscribe: SessionSubscription): TaskPilotDesktopApi {
  const call = async <T>(channel: string, input?: unknown): Promise<T> => unwrapDesktopResult(await invoke(channel, input) as DesktopResult<T>);
  return { auth: {
    getCapabilities: () => call(CHANNELS.getAuthCapabilities),
    startGitHubSignIn: () => call(CHANNELS.startGitHubSignIn),
    continueGitHubSignIn: input => call(CHANNELS.continueGitHubSignIn, input),
    completeGitHubRegistration: input => call(CHANNELS.completeGitHubRegistration, input),
    cancelGitHubSignIn: input => call(CHANNELS.cancelGitHubSignIn, input),
    getSessionView: () => call(CHANNELS.getSessionView),
    subscribeSessionView: subscribe,
    logout: () => call(CHANNELS.logout),
  } };
}
