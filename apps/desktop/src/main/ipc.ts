import { z } from 'zod';
import type { TaskPilotDesktopApi } from '../shared/contracts.js';
import { toDesktopError } from './ipc-result.js';

export const CHANNELS = {
  getAuthCapabilities: 'auth:get-capabilities',
  startGitHubSignIn: 'auth:start-github-sign-in',
  continueGitHubSignIn: 'auth:continue-github-sign-in',
  completeGitHubRegistration: 'auth:complete-github-registration',
  cancelGitHubSignIn: 'auth:cancel-github-sign-in',
  getSessionView: 'auth:get-session-view',
  logout: 'auth:logout',
  sessionChanged: 'auth:session-changed',
  listWorkspaces: 'workspaces:list',
  resolveProjectHome: 'projects:resolve-home',
  listProjects: 'projects:list',
  openProject: 'projects:open',
  createProject: 'projects:create',
  editProject: 'projects:edit',
  archiveProject: 'projects:archive',
  restoreProject: 'projects:restore',
  permanentlyDeleteProject: 'projects:permanently-delete',
  resolveBoardHome: 'boards:resolve-home',
  listBoards: 'boards:list',
  openBoard: 'boards:open',
  createBoard: 'boards:create',
  editBoard: 'boards:edit',
  createColumn: 'boards:columns:create',
  editColumn: 'boards:columns:edit',
  reorderColumns: 'boards:columns:reorder',
  deleteColumn: 'boards:columns:delete',
  createWorkItem: 'boards:work-items:create',
  openWorkItem: 'boards:work-items:open',
  editWorkItem: 'boards:work-items:edit',
  moveCard: 'boards:cards:move',
} as const;

const uuid = z.string().uuid();
const boundedText = (maximum: number) => z.string().refine(value => [...value].length <= maximum);
const location = z.object({ workspaceId: uuid, projectId: uuid }).strict();
const version = z.number().int().nonnegative();
const locale = z.enum(['zh-CN', 'en']);
const statusMutation = location.extend({ expectedVersion: version }).strict();
const boardLocation = location.extend({ boardId: uuid }).strict();
const columnLocation = boardLocation.extend({ columnId: uuid }).strict();
const workItemLocation = location.extend({ workItemId: uuid }).strict();
const schemas = {
  getCapabilities: z.undefined(),
  startGitHubSignIn: z.undefined(),
  continueGitHubSignIn: z.object({ flowId: uuid }).strict(),
  completeGitHubRegistration: z.object({
    flowId: uuid,
    displayName: z.string().trim().min(1).max(200),
    useSuggestedAvatar: z.boolean(),
    legalBundleVersion: z.string().min(1).max(128),
    termsVersion: z.string().min(1).max(128),
    privacyVersion: z.string().min(1).max(128),
    locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).max(35),
  }).strict(),
  cancelGitHubSignIn: z.object({ flowId: uuid }).strict(),
  getSessionView: z.undefined(),
  logout: z.undefined(),
  listWorkspaces: z.undefined(),
  resolveProjectHome: z.undefined(),
  listProjects: z.object({
    workspaceId: uuid, status: z.enum(['ACTIVE', 'ARCHIVED']), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(2048).optional(),
  }).strict(),
  openProject: location,
  createProject: z.object({ workspaceId: uuid, requestId: uuid, name: boundedText(200), description: boundedText(2000).optional(), locale }).strict(),
  editProject: statusMutation.extend({ name: boundedText(200), description: boundedText(2000).optional() }).strict(),
  archiveProject: statusMutation,
  restoreProject: statusMutation,
  permanentlyDeleteProject: statusMutation.extend({ confirmationName: boundedText(200) }).strict(),
  resolveBoardHome: location,
  listBoards: location,
  openBoard: boardLocation,
  createBoard: location.extend({ requestId: uuid, name: boundedText(120), description: boundedText(2000).optional(), locale }).strict(),
  editBoard: boardLocation.extend({ expectedVersion: version, name: boundedText(120), description: boundedText(2000).optional() }).strict(),
  createColumn: boardLocation.extend({ requestId: uuid, expectedBoardVersion: version, name: boundedText(80) }).strict(),
  editColumn: columnLocation.extend({ expectedBoardVersion: version, expectedColumnVersion: version, name: boundedText(80) }).strict(),
  reorderColumns: boardLocation.extend({ expectedBoardVersion: version, columnIds: z.array(uuid).min(1).max(50) }).strict(),
  deleteColumn: columnLocation.extend({ expectedBoardVersion: version, expectedColumnVersion: version }).strict(),
  createWorkItem: boardLocation.extend({ columnId: uuid, requestId: uuid, expectedBoardVersion: version, title: boundedText(300), description: boundedText(10_000).optional() }).strict(),
  openWorkItem: workItemLocation,
  editWorkItem: workItemLocation.extend({
    boardId: uuid,
    currentColumnId: uuid,
    targetColumnId: uuid,
    expectedBoardVersion: version.optional(),
    expectedPlacementVersion: version.optional(),
    expectedVersion: version,
    title: boundedText(300),
    description: boundedText(10_000).optional(),
  }).strict()
    .refine(input => input.currentColumnId === input.targetColumnId || input.expectedBoardVersion !== undefined, { path: ['expectedBoardVersion'] })
    .refine(input => input.currentColumnId === input.targetColumnId || input.expectedPlacementVersion !== undefined, { path: ['expectedPlacementVersion'] }),
  moveCard: boardLocation.extend({ workItemId: uuid, expectedBoardVersion: version, expectedPlacementVersion: version, targetColumnId: uuid, beforeWorkItemId: uuid.optional() }).strict(),
};
type Method = keyof typeof schemas;
type Capability = keyof TaskPilotDesktopApi;
interface EventLike { sender: { id: number }; senderFrame: { url: string; parent: unknown } | null }
export interface WindowScope { webContentsId: number; generation: number; rendererOrigin?: string }

function isTrustedRendererUrl(url: string, rendererOrigin: string | undefined): boolean {
  if (!rendererOrigin) {
    try { const parsed = new URL(url); return parsed.protocol === 'file:' && parsed.hostname === '' && parsed.username === '' && parsed.password === ''; } catch { return false; }
  }
  try { return new URL(url).origin === rendererOrigin; } catch { return false; }
}
export function validateIpcEvent(event: EventLike, scope: WindowScope, generation: number): void {
  if (event.sender.id !== scope.webContentsId || !event.senderFrame || event.senderFrame.parent !== null
    || !isTrustedRendererUrl(event.senderFrame.url, scope.rendererOrigin) || generation !== scope.generation) {
    throw new Error('Untrusted IPC caller');
  }
}
interface IpcRegistrar { handle(channel: string, listener: (event: EventLike, input?: unknown) => unknown): void; removeHandler(channel: string): void }
export function registerDesktopHandlers(ipc: IpcRegistrar, capabilities: TaskPilotDesktopApi, scope: WindowScope): () => void {
  const entries: Array<[string, Capability, Method]> = [
    [CHANNELS.getAuthCapabilities, 'auth', 'getCapabilities'],
    [CHANNELS.startGitHubSignIn, 'auth', 'startGitHubSignIn'],
    [CHANNELS.continueGitHubSignIn, 'auth', 'continueGitHubSignIn'],
    [CHANNELS.completeGitHubRegistration, 'auth', 'completeGitHubRegistration'],
    [CHANNELS.cancelGitHubSignIn, 'auth', 'cancelGitHubSignIn'],
    [CHANNELS.getSessionView, 'auth', 'getSessionView'],
    [CHANNELS.logout, 'auth', 'logout'],
    [CHANNELS.listWorkspaces, 'workspaces', 'listWorkspaces'],
    [CHANNELS.resolveProjectHome, 'projects', 'resolveProjectHome'],
    [CHANNELS.listProjects, 'projects', 'listProjects'],
    [CHANNELS.openProject, 'projects', 'openProject'],
    [CHANNELS.createProject, 'projects', 'createProject'],
    [CHANNELS.editProject, 'projects', 'editProject'],
    [CHANNELS.archiveProject, 'projects', 'archiveProject'],
    [CHANNELS.restoreProject, 'projects', 'restoreProject'],
    [CHANNELS.permanentlyDeleteProject, 'projects', 'permanentlyDeleteProject'],
    [CHANNELS.resolveBoardHome, 'boards', 'resolveBoardHome'],
    [CHANNELS.listBoards, 'boards', 'listBoards'],
    [CHANNELS.openBoard, 'boards', 'openBoard'],
    [CHANNELS.createBoard, 'boards', 'createBoard'],
    [CHANNELS.editBoard, 'boards', 'editBoard'],
    [CHANNELS.createColumn, 'boards', 'createColumn'],
    [CHANNELS.editColumn, 'boards', 'editColumn'],
    [CHANNELS.reorderColumns, 'boards', 'reorderColumns'],
    [CHANNELS.deleteColumn, 'boards', 'deleteColumn'],
    [CHANNELS.createWorkItem, 'boards', 'createWorkItem'],
    [CHANNELS.openWorkItem, 'boards', 'openWorkItem'],
    [CHANNELS.editWorkItem, 'boards', 'editWorkItem'],
    [CHANNELS.moveCard, 'boards', 'moveCard'],
  ];
  const owners: Record<Capability, Record<Method, ((input?: never) => unknown) | undefined>> = {
    auth: {
      getCapabilities: capabilities.auth.getCapabilities, startGitHubSignIn: capabilities.auth.startGitHubSignIn,
      continueGitHubSignIn: capabilities.auth.continueGitHubSignIn, completeGitHubRegistration: capabilities.auth.completeGitHubRegistration,
      cancelGitHubSignIn: capabilities.auth.cancelGitHubSignIn, getSessionView: capabilities.auth.getSessionView, logout: capabilities.auth.logout,
    } as never,
    workspaces: { listWorkspaces: capabilities.workspaces.list } as never,
    projects: {
      resolveProjectHome: capabilities.projects.resolveHome, listProjects: capabilities.projects.list, openProject: capabilities.projects.open,
      createProject: capabilities.projects.create, editProject: capabilities.projects.edit, archiveProject: capabilities.projects.archive,
      restoreProject: capabilities.projects.restore, permanentlyDeleteProject: capabilities.projects.permanentlyDelete,
    } as never,
    boards: {
      resolveBoardHome: capabilities.boards?.resolveHome, listBoards: capabilities.boards?.list, openBoard: capabilities.boards?.open,
      createBoard: capabilities.boards?.create, editBoard: capabilities.boards?.edit, createColumn: capabilities.boards?.createColumn,
      editColumn: capabilities.boards?.editColumn, reorderColumns: capabilities.boards?.reorderColumns, deleteColumn: capabilities.boards?.deleteColumn,
      createWorkItem: capabilities.boards?.createWorkItem, openWorkItem: capabilities.boards?.openWorkItem,
      editWorkItem: capabilities.boards?.editWorkItem, moveCard: capabilities.boards?.moveCard,
    } as never,
  };
  for (const [channel, capability, method] of entries) {
    ipc.handle(channel, async (event, input) => {
      try {
        validateIpcEvent(event, scope, scope.generation);
        if (serializedSize(input) > 16_384) throw Object.assign(new Error('IPC input too large'), { code: 'VALIDATION_FAILED' });
        const parsed = schemas[method].parse(input as never);
        const owner = owners[capability][method];
        if (!owner) throw new Error('Missing IPC capability owner');
        return { ok: true as const, value: await owner.call(capabilities[capability], parsed as never) };
      } catch (error) {
        return { ok: false as const, error: toDesktopError(error) };
      }
    });
  }
  return () => entries.forEach(([channel]) => ipc.removeHandler(channel));
}
function serializedSize(value: unknown): number {
  if (value === undefined) return 0;
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.POSITIVE_INFINITY; }
}
