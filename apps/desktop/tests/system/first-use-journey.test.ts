import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FixedHttpTransport } from '../../src/main/api/transport.js';
import { MemoryFederatedAuthRecoveryStore } from '../../src/main/auth/auth-recovery-store.js';
import type { ExternalBrowser } from '../../src/main/auth/federated-auth-coordinator.js';
import { createDesktopComposition, type DesktopComposition } from '../../src/main/composition.js';
import { MemoryCredentialStore, type CredentialStore } from '../../src/main/credentials/credential-store.js';
import { registerDesktopHandlers } from '../../src/main/ipc.js';
import { LoopbackReceiver } from '../../src/main/auth/loopback-receiver.js';
import { MemoryRecentProjectStore, type RecentProjectStore } from '../../src/main/projects/recent-project-store.js';
import { createTaskPilotDesktopApi } from '../../src/preload/api.js';
import type { FederatedAuthFlowView, TaskPilotDesktopApi } from '../../src/shared/contracts.js';

const baseUrl = process.env.TASKPILOT_SYSTEM_BASE_URL;
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

class ProviderBrowserDouble implements ExternalBrowser {
  readonly opened: string[] = [];

  constructor(private readonly authorizationCode: string) {}

  async open(authorizationUrl: string): Promise<void> {
    if (!baseUrl) throw new Error('TASKPILOT_SYSTEM_BASE_URL is required');
    this.opened.push(authorizationUrl);
    const state = new URL(authorizationUrl).searchParams.get('state');
    if (!state) throw new Error('Provider authorization URL did not contain state');
    const callback = await fetch(
      `${baseUrl}/desktop/v1/auth/federated/github/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(this.authorizationCode)}`,
    );
    expect(callback.status).toBe(200);
    const page = await callback.text();
    const proof = /const proof = "([^"]+)";/.exec(page)?.[1];
    const completionUri = /const target = "([^"]+)";/.exec(page)?.[1];
    if (!proof || !completionUri) throw new Error('Provider callback did not contain loopback delivery data');
    const delivery = await fetch(completionUri, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ completionProof: proof }),
    });
    expect(delivery.status).toBe(204);
  }
}

interface DesktopHarness {
  api: TaskPilotDesktopApi;
  composition: DesktopComposition;
  browser: ProviderBrowserDouble;
  dispose(): void;
}

function createHarness(
  authorizationCode: string,
  recentProjects: RecentProjectStore,
  credentials: CredentialStore = new MemoryCredentialStore(),
): DesktopHarness {
  if (!baseUrl) throw new Error('TASKPILOT_SYSTEM_BASE_URL is required');
  const browser = new ProviderBrowserDouble(authorizationCode);
  const composition = createDesktopComposition({
    environment: 'local',
    transport: new FixedHttpTransport('local', fetch, baseUrl),
    credentials,
    authRecovery: new MemoryFederatedAuthRecoveryStore(),
    recentProjects,
    deviceInstallationId: `system-journey-${authorizationCode}`,
    browser,
    loopback: new LoopbackReceiver(),
  });
  const ipc = new MemoryIpc();
  const disposeHandlers = registerDesktopHandlers(ipc, composition.capabilities, { webContentsId: 71, generation: 1 });
  const api = createTaskPilotDesktopApi(
    (channel, input) => ipc.invoke(channel, input),
    () => () => undefined,
  );
  return {
    api,
    composition,
    browser,
    dispose: () => { disposeHandlers(); },
  };
}

async function beginAndCompleteProvider(harness: DesktopHarness): Promise<FederatedAuthFlowView> {
  const started = await harness.api.auth.startGitHubSignIn();
  if (started.status !== 'waiting') return started;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await harness.api.auth.continueGitHubSignIn({ flowId: started.flowId });
    if (result.status !== 'waiting' && result.status !== 'completionRequired') return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Federated provider double did not complete in time');
}

async function register(harness: DesktopHarness, pending: FederatedAuthFlowView, displayName: string) {
  if (pending.status !== 'registrationRequired') throw new Error(`Expected registrationRequired, received ${pending.status}`);
  return harness.api.auth.completeGitHubRegistration({
    flowId: pending.flowId,
    displayName,
    useSuggestedAvatar: true,
    legalBundleVersion: pending.legalBundleVersion,
    termsVersion: pending.termsVersion,
    privacyVersion: pending.privacyVersion,
    locale: 'en',
  });
}

async function signInExisting(harness: DesktopHarness) {
  const result = await beginAndCompleteProvider(harness);
  expect(result.status).toBe('authenticated');
  return result;
}

describe('Desktop first-use system journey', () => {
  it('crosses provider/browser doubles, Main, IPC, Preload, Core API and PostgreSQL without Agent Runtime', async () => {
    if (!baseUrl) throw new Error('TASKPILOT_SYSTEM_BASE_URL is required');
    const health = await fetch(`${baseUrl}/actuator/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'UP' });

    const recentProjects = new MemoryRecentProjectStore();
    let current = createHarness('1001', recentProjects);
    try {
      expect(Object.keys(current.composition.capabilities)).toEqual(['auth', 'workspaces', 'projects']);
      expect(current.composition).not.toHaveProperty('runtime');
      expect(await current.api.auth.getCapabilities()).toEqual({ github: { enabled: true } });

      const pending = await beginAndCompleteProvider(current);
      const registered = await register(current, pending, 'Journey User');
      expect(registered.status).toBe('authenticated');
      const firstHome = await current.api.projects.resolveHome();
      const workspaceId = firstHome.value.workspace.workspaceId;
      const defaultProject = firstHome.value.currentProject;
      expect(defaultProject).toMatchObject({ workspaceId, name: 'My project', description: '', status: 'ACTIVE' });

      const created = await current.api.projects.create({
        workspaceId,
        requestId: randomUUID(),
        name: 'Recently opened',
        description: 'System journey selection',
      });
      await current.api.projects.open({ workspaceId, projectId: created.value.projectId });
      await current.api.auth.logout();
      current.dispose();

      current = createHarness('1001', recentProjects);
      await signInExisting(current);
      const recentHome = await current.api.projects.resolveHome();
      expect(recentHome.value.currentProject?.projectId).toBe(created.value.projectId);

      const archived = await current.api.projects.archive({
        workspaceId,
        projectId: created.value.projectId,
        expectedVersion: created.value.version,
      });
      await current.api.auth.logout();
      current.dispose();

      current = createHarness('1001', recentProjects);
      await signInExisting(current);
      const fallbackHome = await current.api.projects.resolveHome();
      expect(fallbackHome.value.currentProject?.projectId).toBe(defaultProject?.projectId);

      await current.api.projects.permanentlyDelete({
        workspaceId,
        projectId: archived.value.projectId,
        expectedVersion: archived.value.version,
        confirmationName: archived.value.name,
      });
      if (!defaultProject) throw new Error('Default Project was not selected');
      await current.api.projects.permanentlyDelete({
        workspaceId,
        projectId: defaultProject.projectId,
        expectedVersion: defaultProject.version,
        confirmationName: defaultProject.name,
      });
      const emptyHome = await current.api.projects.resolveHome();
      expect(emptyHome.value).toMatchObject({ workspace: { workspaceId }, projects: [] });
      expect(emptyHome.value.currentProject).toBeUndefined();

      await current.api.auth.logout();
      current.dispose();

      current = createHarness('2002', recentProjects);
      const failurePending = await beginAndCompleteProvider(current);
      await expect(register(current, failurePending, 'Session Failure')).rejects.toMatchObject({
        category: 'temporary',
      });
      expect(await current.api.auth.getSessionView()).toEqual({ status: 'signedOut' });
      if (failurePending.status !== 'registrationRequired') throw new Error('Expected retryable registration context');
      await current.api.auth.cancelGitHubSignIn({ flowId: failurePending.flowId });
      current.dispose();

      current = createHarness('2002', recentProjects);
      await signInExisting(current);
      const recoveredHome = await current.api.projects.resolveHome();
      expect(recoveredHome.value.currentProject).toMatchObject({ name: 'My project', status: 'ACTIVE' });
      expect(current.browser.opened).toHaveLength(1);

      const retired = await fetch(`${baseUrl}/desktop/v1/auth/login/code`);
      expect(retired.status).toBe(404);
    } finally {
      current.dispose();
      await current.composition.federatedAuth.close().catch(() => undefined);
      await current.api.auth.logout().catch(() => undefined);
    }
  }, 60_000);
});
