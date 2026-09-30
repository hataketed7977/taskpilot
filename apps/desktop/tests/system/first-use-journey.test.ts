import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FixedHttpTransport } from '../../src/main/api/transport.js';
import { createDesktopComposition } from '../../src/main/composition.js';
import { MemoryCredentialStore } from '../../src/main/credentials/credential-store.js';
import { registerDesktopHandlers } from '../../src/main/ipc.js';
import { MemoryPreferenceStore } from '../../src/main/workspaces/active-workspace.js';
import { createTaskPilotDesktopApi } from '../../src/preload/api.js';

const baseUrl = process.env.TASKPILOT_SYSTEM_BASE_URL;
const fixtureToken = process.env.TASKPILOT_SYSTEM_FIXTURE_TOKEN;
const trustedEvent = { sender: { id: 71 }, senderFrame: { url: 'file:///taskpilot/index.html', parent: null } };

interface Handler {
  (event: typeof trustedEvent, input?: unknown): unknown;
}

class MemoryIpc {
  private readonly handlers = new Map<string, Handler>();
  handle(channel: string, listener: Handler): void { this.handlers.set(channel, listener); }
  removeHandler(channel: string): void { this.handlers.delete(channel); }
  async invoke(channel: string, input?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
    return handler(trustedEvent, input);
  }
}

async function fixture<T>(path: string, init?: RequestInit): Promise<T> {
  if (!baseUrl || !fixtureToken) throw new Error('System fixture environment is missing');
  const response = await fetch(`${baseUrl}/__system-test${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-System-Test-Token': fixtureToken, ...init?.headers },
  });
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status} ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function latestCode(template: string, recipient: string): Promise<string> {
  const result = await fixture<{ code: string }>(`/mail/latest?template=${encodeURIComponent(template)}&recipient=${encodeURIComponent(recipient)}`);
  return result.code;
}

function expectAuthenticated(view: Awaited<ReturnType<ReturnType<typeof createTaskPilotDesktopApi>['auth']['getSessionView']>>) {
  expect(view.status).toBe('authenticated');
  if (view.status !== 'authenticated') throw new Error('Expected authenticated session');
  return view.currentUser;
}

describe('Desktop first-use system journey', () => {
  it('crosses real Main and Preload boundaries into Core API, PostgreSQL and capture mail', async () => {
    if (!baseUrl) throw new Error('TASKPILOT_SYSTEM_BASE_URL is required');
    const transport = new FixedHttpTransport('local', fetch, baseUrl);
    const composition = createDesktopComposition({
      environment: 'local',
      transport,
      credentials: new MemoryCredentialStore(),
      preferences: new MemoryPreferenceStore(),
      deviceInstallationId: 'system-journey-device',
    });
    expect(Object.keys(composition.capabilities).sort()).toEqual(['auth', 'projects', 'workspaces']);
    expect(composition).not.toHaveProperty('runtime');
    const ipc = new MemoryIpc();
    const dispose = registerDesktopHandlers(ipc, composition.capabilities, { webContentsId: 71, generation: 1 });
    const api = createTaskPilotDesktopApi(async (channel, input) => {
      const result = await ipc.invoke(channel, input);
      if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === false) {
        throw new Error(`System IPC ${channel} failed: ${JSON.stringify(result)}`);
      }
      return result;
    }, () => () => undefined);

    const email = `system-${randomUUID()}@example.com`;
    const originalPassword = 'A distinct valid password 2026!';
    const newPassword = 'A replacement password 2026!';

    const registrationChallenge = await api.auth.requestRegistrationCode({ email });
    const registrationFlow = await api.auth.verifyRegistrationCode({
      challengeId: registrationChallenge.challengeId,
      email,
      code: await latestCode('REGISTRATION_CODE', email),
    });
    const registeredUser = expectAuthenticated(await api.auth.register({
      flowHandle: registrationFlow.flowHandle,
      email,
      displayName: 'System Journey User',
      password: originalPassword,
      termsVersion: '2026-09',
    }));

    await api.auth.logout();
    expectAuthenticated(await api.auth.signInWithPassword({ email, password: originalPassword }));
    await api.auth.logout();

    const loginChallenge = await api.auth.requestLoginCode({ email });
    expectAuthenticated(await api.auth.verifyLoginCode({
      challengeId: loginChallenge.challengeId,
      email,
      code: await latestCode('LOGIN_CODE', email),
    }));
    await api.auth.logout();

    const resetChallenge = await api.auth.requestPasswordResetCode({ email });
    const resetFlow = await api.auth.verifyPasswordResetCode({
      challengeId: resetChallenge.challengeId,
      email,
      code: await latestCode('PASSWORD_RESET_CODE', email),
    });
    await api.auth.resetPassword({ flowHandle: resetFlow.flowHandle, email, newPassword });
    expectAuthenticated(await api.auth.signInWithPassword({ email, password: newPassword }));
    await composition.session.refresh();
    expectAuthenticated(await api.auth.getSessionView());

    const initialWorkspaces = await api.workspaces.listWorkspaces();
    expect(initialWorkspaces.items).toEqual([]);
    expect(initialWorkspaces.capabilities.canCreateWorkspace).toBe(true);

    const creationRequestId = randomUUID();
    const created = await api.workspaces.createWorkspace({ name: 'System Workspace', creationRequestId });
    const replayed = await api.workspaces.createWorkspace({ name: 'System Workspace', creationRequestId });
    expect(replayed).toEqual(created);

    const listed = await api.workspaces.listWorkspaces();
    expect(listed.items).toContainEqual(created);
    expect(await api.workspaces.restoreActiveWorkspace({ availableWorkspaceIds: listed.items.map(item => item.workspaceId) }))
      .toEqual({ workspaceId: created.workspaceId });
    await api.workspaces.selectWorkspace({ workspaceId: created.workspaceId });

    expect(await api.projects.listProjects({ workspaceId: created.workspaceId })).toEqual({ items: [] });
    const project = await fixture<{ projectId: string; workspaceId: string; name: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ userId: registeredUser.userId, workspaceId: created.workspaceId, name: 'System Project' }),
    });
    expect(await api.projects.listProjects({ workspaceId: created.workspaceId })).toEqual({ items: [project] });
    await api.auth.logout();
    expect(await api.auth.getSessionView()).toEqual({ status: 'signedOut' });
    dispose();
  });
});
