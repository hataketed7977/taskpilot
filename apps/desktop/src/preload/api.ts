import type { DesktopResult, SessionView, TaskPilotDesktopApi } from '../shared/contracts.js';
import { unwrapDesktopResult } from '../main/ipc-result.js';
import { CHANNELS } from '../main/ipc.js';
export type DesktopInvoke = (channel: string, input?: unknown) => Promise<unknown>;
export type SessionSubscription = (listener: (view: SessionView) => void) => () => void;
export function createTaskPilotDesktopApi(invoke: DesktopInvoke, subscribe: SessionSubscription): TaskPilotDesktopApi {
  const call = async <T>(channel: string, input?: unknown): Promise<T> => unwrapDesktopResult(await invoke(channel, input) as DesktopResult<T>);
  return {
    auth: {
      getCapabilities: () => call(CHANNELS.getAuthCapabilities),
      startGitHubSignIn: () => call(CHANNELS.startGitHubSignIn),
      continueGitHubSignIn: input => call(CHANNELS.continueGitHubSignIn, input),
      completeGitHubRegistration: input => call(CHANNELS.completeGitHubRegistration, input),
      cancelGitHubSignIn: input => call(CHANNELS.cancelGitHubSignIn, input),
      getSessionView: () => call(CHANNELS.getSessionView),
      subscribeSessionView: subscribe,
      logout: () => call(CHANNELS.logout),
    },
    workspaces: {
      list: () => call(CHANNELS.listWorkspaces),
    },
    projects: {
      resolveHome: () => call(CHANNELS.resolveProjectHome),
      list: input => call(CHANNELS.listProjects, input),
      open: input => call(CHANNELS.openProject, input),
      create: input => call(CHANNELS.createProject, input),
      edit: input => call(CHANNELS.editProject, input),
      archive: input => call(CHANNELS.archiveProject, input),
      restore: input => call(CHANNELS.restoreProject, input),
      permanentlyDelete: input => call(CHANNELS.permanentlyDeleteProject, input),
    },
    boards: {
      resolveHome: input => call(CHANNELS.resolveBoardHome, input),
      list: input => call(CHANNELS.listBoards, input),
      open: input => call(CHANNELS.openBoard, input),
      create: input => call(CHANNELS.createBoard, input),
      edit: input => call(CHANNELS.editBoard, input),
      permanentlyDelete: input => call(CHANNELS.permanentlyDeleteBoard, input),
      createColumn: input => call(CHANNELS.createColumn, input),
      editColumn: input => call(CHANNELS.editColumn, input),
      reorderColumns: input => call(CHANNELS.reorderColumns, input),
      deleteColumn: input => call(CHANNELS.deleteColumn, input),
      createWorkItem: input => call(CHANNELS.createWorkItem, input),
      openWorkItem: input => call(CHANNELS.openWorkItem, input),
      editWorkItem: input => call(CHANNELS.editWorkItem, input),
      moveCard: input => call(CHANNELS.moveCard, input),
    },
  };
}
