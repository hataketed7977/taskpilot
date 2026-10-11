import { z } from 'zod';
import type { AuthCapabilities } from '../shared/contracts.js';
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
} as const;

const flowId = z.string().uuid();
const schemas = {
  getCapabilities: z.undefined(),
  startGitHubSignIn: z.undefined(),
  continueGitHubSignIn: z.object({ flowId }).strict(),
  completeGitHubRegistration: z.object({
    flowId,
    displayName: z.string().trim().min(1).max(200),
    useSuggestedAvatar: z.boolean(),
    legalBundleVersion: z.string().min(1).max(128),
    termsVersion: z.string().min(1).max(128),
    privacyVersion: z.string().min(1).max(128),
    locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).max(35),
  }).strict(),
  cancelGitHubSignIn: z.object({ flowId }).strict(),
  getSessionView: z.undefined(),
  logout: z.undefined(),
};
type Method = keyof typeof schemas;
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
export function registerDesktopHandlers(ipc: IpcRegistrar, capabilities: Pick<{ auth: AuthCapabilities }, 'auth'>, scope: WindowScope): () => void {
  const entries: Array<[string, Method]> = [
    [CHANNELS.getAuthCapabilities, 'getCapabilities'],
    [CHANNELS.startGitHubSignIn, 'startGitHubSignIn'],
    [CHANNELS.continueGitHubSignIn, 'continueGitHubSignIn'],
    [CHANNELS.completeGitHubRegistration, 'completeGitHubRegistration'],
    [CHANNELS.cancelGitHubSignIn, 'cancelGitHubSignIn'],
    [CHANNELS.getSessionView, 'getSessionView'],
    [CHANNELS.logout, 'logout'],
  ];
  for (const [channel, method] of entries) {
    ipc.handle(channel, async (event, input) => {
      try {
        validateIpcEvent(event, scope, scope.generation);
        if (serializedSize(input) > 16_384) throw Object.assign(new Error('IPC input too large'), { code: 'VALIDATION_FAILED' });
        const parsed = schemas[method].parse(input as never);
        const fn = capabilities.auth[method] as (input?: unknown) => unknown;
        return { ok: true as const, value: await fn.call(capabilities.auth, parsed) };
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
