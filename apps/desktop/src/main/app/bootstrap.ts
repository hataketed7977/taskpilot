import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncEntry } from '@napi-rs/keyring';
import { app, ipcMain, shell } from 'electron';
import { FixedHttpTransport, type Environment } from '../api/transport.js';
import { KeyringFederatedAuthRecoveryStore } from '../auth/auth-recovery-store.js';
import { createDesktopComposition } from '../composition.js';
import { KeyringCredentialStore } from '../credentials/credential-store.js';
import { CHANNELS, registerDesktopHandlers } from '../ipc.js';
import { JsonRecentBoardStore } from '../projects/recent-board-store.js';
import { JsonRecentProjectStore } from '../projects/recent-project-store.js';
import { createDesktopWindow } from './create-window.js';
import { stableDeviceId } from './device-id.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function bootstrapDesktopApp(): Promise<void> {
  const environment: Environment = app.isPackaged ? 'production' : 'local';
  const userData = app.getPath('userData');
  const { window, renderer, load } = createDesktopWindow({
    isPackaged: app.isPackaged,
    here,
    devServerUrl: process.env.TASKPILOT_DESKTOP_DEV_SERVER_URL,
  });

  const transport = new FixedHttpTransport(
    environment,
    fetch,
    environment === 'local' ? process.env.TASKPILOT_CORE_API_URL : undefined,
  );
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
    browser: {
      open: async (url) => {
        await shell.openExternal(url, { activate: true });
      },
    },
    activateDesktop: () => {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
  });
  const { capabilities, session, federatedAuth } = composition;
  const dispose = registerDesktopHandlers(ipcMain, capabilities, {
    webContentsId: window.webContents.id,
    generation: 1,
    rendererOrigin: renderer.kind === 'dev-server' ? renderer.origin : undefined,
  });
  const unsubscribe = session.subscribe((view) => {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.sessionChanged, view);
  });
  window.on('closed', () => {
    void federatedAuth.close();
    dispose();
    unsubscribe();
  });

  await load();
  void federatedAuth.restore()
    .then(() => session.restore())
    .catch(() => undefined);
}
