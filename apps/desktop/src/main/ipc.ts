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
} as const;

const uuid = z.string().uuid();
const boundedText = (maximum: number) => z.string().refine(value => [...value].length <= maximum);
const location = z.object({ workspaceId: uuid, projectId: uuid }).strict();
const statusMutation = location.extend({ expectedVersion: z.number().int().nonnegative() }).strict();
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
  createProject: z.object({ workspaceId: uuid, requestId: uuid, name: boundedText(200), description: boundedText(2000).optional() }).strict(),
  editProject: statusMutation.extend({ name: boundedText(200), description: boundedText(2000).optional() }).strict(),
  archiveProject: statusMutation,
  restoreProject: statusMutation,
  permanentlyDeleteProject: statusMutation.extend({ confirmationName: boundedText(200) }).strict(),
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
