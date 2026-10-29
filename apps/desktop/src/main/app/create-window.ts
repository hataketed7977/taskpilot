import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { resolveDesktopRendererLocation } from '../renderer-location.js';
import { installWindowSecurity } from './window-security.js';

export type DesktopWindowHandle = {
  window: BrowserWindow;
  renderer: ReturnType<typeof resolveDesktopRendererLocation>;
  load(): Promise<void>;
};

export function createDesktopWindow(options: { isPackaged: boolean; here: string; devServerUrl?: string }): DesktopWindowHandle {
  const renderer = resolveDesktopRendererLocation(options.isPackaged, options.devServerUrl);
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(options.here, '../../preload/index.cjs'),
    },
  });

  installWindowSecurity(window, { logRendererConsole: renderer.kind === 'dev-server' });

  return {
    window,
    renderer,
    async load() {
      if (renderer.kind === 'dev-server') await window.loadURL(renderer.url);
      else await window.loadFile(join(options.here, '../../renderer/index.html'));
    },
  };
}
