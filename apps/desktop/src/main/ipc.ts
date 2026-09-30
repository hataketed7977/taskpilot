import { z } from 'zod';
import type { AuthCapabilities, ProjectCapabilities, WorkspaceCapabilities } from '../shared/contracts.js';
import { toDesktopError } from './ipc-result.js';

export const CHANNELS = {
  signInWithPassword: 'auth:sign-in-password', requestLoginCode: 'auth:request-login-code', verifyLoginCode: 'auth:verify-login-code',
  requestRegistrationCode: 'auth:request-registration-code', verifyRegistrationCode: 'auth:verify-registration-code', register: 'auth:register',
  requestPasswordResetCode: 'auth:request-password-reset-code', verifyPasswordResetCode: 'auth:verify-password-reset-code', resetPassword: 'auth:reset-password',
  getSessionView: 'auth:get-session-view', logout: 'auth:logout', sessionChanged: 'auth:session-changed',
  listWorkspaces: 'workspace:list', createWorkspace: 'workspace:create', restoreActiveWorkspace: 'workspace:restore-active',
  selectWorkspace: 'workspace:select', clearActiveWorkspace: 'workspace:clear-active', listProjects: 'project:list',
} as const;

const email = z.string().trim().email().max(320);
const password = z.string().min(1).max(1024);
const uuid = z.string().uuid();
const code = z.string().regex(/^\d{6}$/);
const schemas = {
  signInWithPassword: z.object({ email, password }).strict(),
  requestLoginCode: z.object({ email }).strict(),
  verifyLoginCode: z.object({ challengeId: uuid, email, code }).strict(),
  requestRegistrationCode: z.object({ email }).strict(),
  verifyRegistrationCode: z.object({ challengeId: uuid, email, code }).strict(),
  register: z.object({ flowHandle: uuid, email, displayName: z.string().trim().min(1).max(120), password, termsVersion: z.string().min(1).max(64) }).strict(),
  requestPasswordResetCode: z.object({ email }).strict(),
  verifyPasswordResetCode: z.object({ challengeId: uuid, email, code }).strict(),
  resetPassword: z.object({ flowHandle: uuid, email, newPassword: password }).strict(),
  getSessionView: z.undefined(), logout: z.undefined(), listWorkspaces: z.undefined(),
  createWorkspace: z.object({ name: z.string().trim().min(1).max(160), creationRequestId: uuid }).strict(),
  restoreActiveWorkspace: z.object({ availableWorkspaceIds: z.array(uuid).max(1000) }).strict(),
  selectWorkspace: z.object({ workspaceId: uuid }).strict(), clearActiveWorkspace: z.undefined(),
  listProjects: z.object({ workspaceId: uuid, cursor: z.string().min(1).max(2048).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
} as const;

type Method = keyof typeof schemas;
interface EventLike { sender: { id: number }; senderFrame: { url: string; parent: unknown } | null }
interface WindowScope { webContentsId: number; generation: number }
export function validateIpcEvent(event: EventLike, scope: WindowScope, generation: number): void {
  if (event.sender.id !== scope.webContentsId || !event.senderFrame || event.senderFrame.parent !== null || !event.senderFrame.url.startsWith('file://') || generation !== scope.generation) throw new Error('Untrusted IPC caller');
}
interface IpcRegistrar { handle(channel: string, listener: (event: EventLike, input?: unknown) => unknown): void; removeHandler(channel: string): void }
type Owners = { auth: AuthCapabilities; workspaces: WorkspaceCapabilities; projects: ProjectCapabilities };

export function registerDesktopHandlers(ipc: IpcRegistrar, capabilities: Owners, scope: WindowScope): () => void {
  const entries: Array<[string, Method, AuthCapabilities | WorkspaceCapabilities | ProjectCapabilities]> = [
    [CHANNELS.signInWithPassword, 'signInWithPassword', capabilities.auth], [CHANNELS.requestLoginCode, 'requestLoginCode', capabilities.auth], [CHANNELS.verifyLoginCode, 'verifyLoginCode', capabilities.auth],
    [CHANNELS.requestRegistrationCode, 'requestRegistrationCode', capabilities.auth], [CHANNELS.verifyRegistrationCode, 'verifyRegistrationCode', capabilities.auth], [CHANNELS.register, 'register', capabilities.auth],
    [CHANNELS.requestPasswordResetCode, 'requestPasswordResetCode', capabilities.auth], [CHANNELS.verifyPasswordResetCode, 'verifyPasswordResetCode', capabilities.auth], [CHANNELS.resetPassword, 'resetPassword', capabilities.auth],
    [CHANNELS.getSessionView, 'getSessionView', capabilities.auth], [CHANNELS.logout, 'logout', capabilities.auth], [CHANNELS.listWorkspaces, 'listWorkspaces', capabilities.workspaces],
    [CHANNELS.createWorkspace, 'createWorkspace', capabilities.workspaces], [CHANNELS.restoreActiveWorkspace, 'restoreActiveWorkspace', capabilities.workspaces],
    [CHANNELS.selectWorkspace, 'selectWorkspace', capabilities.workspaces], [CHANNELS.clearActiveWorkspace, 'clearActiveWorkspace', capabilities.workspaces], [CHANNELS.listProjects, 'listProjects', capabilities.projects],
  ];
  for (const [channel, method, owner] of entries) {
    ipc.handle(channel, async (event, input) => {
      try {
        validateIpcEvent(event, scope, scope.generation);
        const parsed = schemas[method].parse(input as never);
        const fn = (owner as Partial<Record<Method, unknown>>)[method];
        if (typeof fn !== 'function') throw Object.assign(new Error('Capability unavailable'), { code: 'CAPABILITY_UNAVAILABLE' });
        return { ok: true as const, value: await fn.call(owner, parsed) };
      } catch (error) {
        return { ok: false as const, error: toDesktopError(error) };
      }
    });
  }
  return () => entries.forEach(([channel]) => ipc.removeHandler(channel));
}
