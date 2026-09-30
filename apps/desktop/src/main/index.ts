import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncEntry } from '@napi-rs/keyring';
import { app, BrowserWindow, ipcMain } from 'electron';
import { FixedHttpTransport, type Environment } from './api/transport.js';
import { createDesktopComposition } from './composition.js';
import { KeyringCredentialStore } from './credentials/credential-store.js';
import { CHANNELS, registerDesktopHandlers } from './ipc.js';
import type { PreferenceStore } from './workspaces/active-workspace.js';

const here = dirname(fileURLToPath(import.meta.url));
const environment: Environment = app.isPackaged ? 'production' : 'local';
class FilePreferenceStore implements PreferenceStore {
  private values?: Record<string, string>;
  constructor(private readonly path: string) {}
  private async load() { if (this.values) return this.values; try { this.values = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, string>; } catch { this.values = {}; } return this.values; }
  private async persist() { await writeFile(this.path, JSON.stringify(this.values), { mode: 0o600 }); }
  async get(key: string) { return (await this.load())[key]; }
  async set(key: string, value: string) { (await this.load())[key] = value; await this.persist(); }
  async delete(key: string) { delete (await this.load())[key]; await this.persist(); }
}
async function stableDeviceId(path: string): Promise<string> { try { return (await readFile(path, 'utf8')).trim(); } catch { const value = randomUUID(); await writeFile(path, value, { mode: 0o600 }); return value; } }
async function createWindow() {
  const userData = app.getPath('userData');
  const window = new BrowserWindow({ width: 1180, height: 760, minWidth: 960, minHeight: 640, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(here, '../preload/index.js') } });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const transport = new FixedHttpTransport(environment);
  const credentials = new KeyringCredentialStore((service, account) => new AsyncEntry(service, account));
  const deviceInstallationId = await stableDeviceId(join(userData, 'device-installation-id'));
  const composition = createDesktopComposition({
    environment,
    transport,
    credentials,
    preferences: new FilePreferenceStore(join(userData, 'preferences.json')),
    deviceInstallationId,
  });
  const { capabilities, session, flows } = composition;
  const dispose = registerDesktopHandlers(ipcMain, capabilities, { webContentsId: window.webContents.id, generation: 1 });
  const unsubscribe = session.subscribe(view => { if (!window.isDestroyed()) window.webContents.send(CHANNELS.sessionChanged, view); });
  window.on('closed', () => { flows.clear(); dispose(); unsubscribe(); });
  await window.loadFile(join(here, '../renderer/index.html'));
  void session.restore().catch(() => undefined);
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
