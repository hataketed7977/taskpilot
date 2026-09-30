import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [appAsar, platform] = process.argv.slice(2);
const baseUrl = process.env.TASKPILOT_SYSTEM_BASE_URL;
const fixtureToken = process.env.TASKPILOT_SYSTEM_FIXTURE_TOKEN;
if (!appAsar || !platform || !baseUrl || !fixtureToken) {
  throw new Error('Packaged worker requires app.asar, platform, and isolated fixture configuration');
}
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseUrl)) {
  throw new Error('Packaged worker accepts only an explicit loopback Core API fixture');
}

const packagedUrl = relativePath => pathToFileURL(path.join(appAsar, relativePath)).href;
const [compositionModule, credentialModule, ipcModule, preloadModule, transportModule] = await Promise.all([
  import(packagedUrl('dist/main/composition.js')),
  import(packagedUrl('dist/main/credentials/credential-store.js')),
  import(packagedUrl('dist/main/ipc.js')),
  import(packagedUrl('dist/preload/api.js')),
  import(packagedUrl('dist/main/api/transport.js')),
]);
const requireFromPackage = createRequire(path.join(appAsar, 'package.json'));
const { AsyncEntry } = requireFromPackage('@napi-rs/keyring');
const { createDesktopComposition } = compositionModule;
const { KeyringCredentialStore } = credentialModule;
const { registerDesktopHandlers } = ipcModule;
const { createTaskPilotDesktopApi } = preloadModule;
const { FixedHttpTransport } = transportModule;

const trustedEvent = { sender: { id: 71 }, senderFrame: { url: 'file:///taskpilot/index.html', parent: null } };
class MemoryIpc {
  handlers = new Map();
  handle(channel, listener) { this.handlers.set(channel, listener); }
  removeHandler(channel) { this.handlers.delete(channel); }
  async invoke(channel, input) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`Missing packaged IPC handler: ${channel}`);
    return handler(trustedEvent, input);
  }
}
class MemoryPreferenceStore {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async set(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const fixture = async (requestPath, init) => {
  const response = await fetch(`${baseUrl}/__system-test${requestPath}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-System-Test-Token': fixtureToken, ...init?.headers },
  });
  if (!response.ok) throw new Error(`Packaged fixture request failed with status ${response.status}`);
  return response.status === 204 ? undefined : response.json();
};
const latestCode = async (template, recipient) => {
  const result = await fixture(`/mail/latest?template=${encodeURIComponent(template)}&recipient=${encodeURIComponent(recipient)}`);
  return result.code;
};
const authenticatedUser = view => {
  assert(view.status === 'authenticated', 'Expected an authenticated packaged session');
  return view.currentUser;
};

const namespace = `release-smoke.${randomUUID()}`;
const createEntry = (service, account) => new AsyncEntry(`${service}.${namespace}`, account);
const credentials = new KeyringCredentialStore(createEntry);
const transport = new FixedHttpTransport('local', fetch, baseUrl);
const composition = createDesktopComposition({
  environment: 'local',
  transport,
  credentials,
  preferences: new MemoryPreferenceStore(),
  deviceInstallationId: `packaged-${randomUUID()}`,
});
assert(JSON.stringify(Object.keys(composition.capabilities).sort()) === JSON.stringify(['auth', 'projects', 'workspaces']), 'Unexpected packaged capability surface');
assert(!Object.hasOwn(composition, 'runtime'), 'Packaged first-use unexpectedly initialized Runtime');
const ipc = new MemoryIpc();
const dispose = registerDesktopHandlers(ipc, composition.capabilities, { webContentsId: 71, generation: 1 });
const api = createTaskPilotDesktopApi((channel, input) => ipc.invoke(channel, input), () => () => undefined);

try {
  const email = `packaged-${randomUUID()}@example.com`;
  const originalPassword = 'A distinct valid password 2026!';
  const newPassword = 'A replacement password 2026!';

  const registrationChallenge = await api.auth.requestRegistrationCode({ email });
  const registrationFlow = await api.auth.verifyRegistrationCode({
    challengeId: registrationChallenge.challengeId,
    email,
    code: await latestCode('REGISTRATION_CODE', email),
  });
  const registeredUser = authenticatedUser(await api.auth.register({
    flowHandle: registrationFlow.flowHandle,
    email,
    displayName: 'Packaged Journey User',
    password: originalPassword,
    termsVersion: '2026-09',
  }));
  const restoredCredential = await new KeyringCredentialStore(createEntry).loadCurrent('local');
  assert(restoredCredential?.userId === registeredUser.userId, 'Packaged OS credential did not survive store reconstruction');

  await api.auth.logout();
  authenticatedUser(await api.auth.signInWithPassword({ email, password: originalPassword }));
  await api.auth.logout();

  const loginChallenge = await api.auth.requestLoginCode({ email });
  authenticatedUser(await api.auth.verifyLoginCode({
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
  authenticatedUser(await api.auth.signInWithPassword({ email, password: newPassword }));
  const beforeRefresh = await credentials.loadCurrent('local');
  await composition.session.refresh();
  const afterRefresh = await new KeyringCredentialStore(createEntry).loadCurrent('local');
  assert(beforeRefresh?.refreshToken !== afterRefresh?.refreshToken, 'Packaged refresh did not rotate OS credential material');

  const initialWorkspaces = await api.workspaces.listWorkspaces();
  assert(initialWorkspaces.items.length === 0, 'Expected no initial packaged Workspace');
  assert(initialWorkspaces.capabilities.canCreateWorkspace === true, 'Expected packaged Workspace creation capability');
  const creationRequestId = randomUUID();
  const created = await api.workspaces.createWorkspace({ name: 'Packaged Workspace', creationRequestId });
  const replayed = await api.workspaces.createWorkspace({ name: 'Packaged Workspace', creationRequestId });
  assert(JSON.stringify(replayed) === JSON.stringify(created), 'Packaged Workspace retry was not idempotent');
  const listed = await api.workspaces.listWorkspaces();
  assert(listed.items.some(item => item.workspaceId === created.workspaceId), 'Created Workspace missing from packaged list');
  const restored = await api.workspaces.restoreActiveWorkspace({ availableWorkspaceIds: listed.items.map(item => item.workspaceId) });
  assert(restored.workspaceId === created.workspaceId, 'Packaged active Workspace did not restore');
  await api.workspaces.selectWorkspace({ workspaceId: created.workspaceId });
  const emptyProjects = await api.projects.listProjects({ workspaceId: created.workspaceId });
  assert(emptyProjects.items.length === 0, 'Expected a genuine empty packaged Project list');
  const project = await fixture('/projects', {
    method: 'POST',
    body: JSON.stringify({ userId: registeredUser.userId, workspaceId: created.workspaceId, name: 'Packaged Project' }),
  });
  const projects = await api.projects.listProjects({ workspaceId: created.workspaceId });
  assert(projects.items.length === 1 && projects.items[0].projectId === project.projectId, 'Packaged Project list did not return fixture data');

  await api.auth.logout();
  assert((await api.auth.getSessionView()).status === 'signedOut', 'Packaged logout did not clear session state');
  assert(await new KeyringCredentialStore(createEntry).loadCurrent('local') === undefined, 'Packaged logout left OS credential material');
  console.log(JSON.stringify({
    ok: true,
    artifact: 'app.asar',
    platform,
    boundaries: ['main', 'preload', 'ipc', 'core-api', 'postgresql', 'capture-mail', 'os-credential'],
  }));
} finally {
  dispose();
  await credentials.clearCurrent('local').catch(() => undefined);
}
