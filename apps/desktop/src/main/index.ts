import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncEntry } from '@napi-rs/keyring';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { FixedHttpTransport, type Environment } from './api/transport.js';
import { createDesktopComposition } from './composition.js';
import { KeyringCredentialStore } from './credentials/credential-store.js';
import { JsonRecentProjectStore } from './projects/recent-project-store.js';
import { JsonRecentBoardStore } from './projects/recent-board-store.js';
import { KeyringFederatedAuthRecoveryStore } from './auth/auth-recovery-store.js';
import { CHANNELS, registerDesktopHandlers } from './ipc.js';
import { resolveDesktopRendererLocation } from './renderer-location.js';

const here = dirname(fileURLToPath(import.meta.url));
const environment: Environment = app.isPackaged ? 'production' : 'local';
async function stableDeviceId(path: string): Promise<string> { try { return (await readFile(path, 'utf8')).trim(); } catch { const value = randomUUID(); await writeFile(path, value, { mode: 0o600 }); return value; } }
async function createWindow() {
  const userData = app.getPath('userData');
  const renderer = resolveDesktopRendererLocation(app.isPackaged, process.env.TASKPILOT_DESKTOP_DEV_SERVER_URL);
  const window = new BrowserWindow({ width: 1180, height: 760, minWidth: 960, minHeight: 640, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(here, '../preload/index.cjs') } });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('preload-error', (_event, preloadPath, error) => console.error(`Preload failed (${preloadPath}):`, error));
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => { if (isMainFrame) console.error(`Renderer failed to load ${url}: ${code} ${description}`); });
  window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer process exited:', details));
  if (renderer.kind === 'dev-server') {
    window.webContents.on('console-message', details => {
      if (details.level === 'warning' || details.level === 'error') console.error(`[Renderer ${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    });
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const transport = new FixedHttpTransport(environment, fetch, environment === 'local' ? process.env.TASKPILOT_CORE_API_URL : undefined);
  const createKeyringEntry = (service: string, account: string) => new AsyncEntry(service, account);
  const credentials = new KeyringCredentialStore(createKeyringEntry);
  const deviceInstallationId = await stableDeviceId(join(userData, 'device-installation-id'));
  const composition = createDesktopComposition({
    environment,
    transport,
    credentials,
    authRecovery: new KeyringFederatedAuthRecoveryStore(createKeyringEntry),
    recentProjects: new JsonRecentProjectStore(join(userData, 'recent-projects.json')),
    recentBoards: new JsonRecentBoardStore(join(userData, 'recent-boards.json')),
    deviceInstallationId,
    browser: { open: async url => { await shell.openExternal(url, { activate: true }); } },
    activateDesktop: () => {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
  });
  const { capabilities, session, federatedAuth } = composition;
  const dispose = registerDesktopHandlers(ipcMain, capabilities, { webContentsId: window.webContents.id, generation: 1, rendererOrigin: renderer.kind === 'dev-server' ? renderer.origin : undefined });
  const unsubscribe = session.subscribe(view => { if (!window.isDestroyed()) window.webContents.send(CHANNELS.sessionChanged, view); });
  window.on('closed', () => { void federatedAuth.close(); dispose(); unsubscribe(); });
  if (renderer.kind === 'dev-server') await window.loadURL(renderer.url);
  else await window.loadFile(join(here, '../renderer/index.html'));
  void federatedAuth.restore()
    .then(() => session.restore())
    .catch(() => undefined);
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
