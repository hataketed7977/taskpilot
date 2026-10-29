import type { BrowserWindow } from 'electron';

export function installWindowSecurity(window: BrowserWindow, options: { logRendererConsole: boolean }): void {
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Preload failed (${preloadPath}):`, error);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) console.error(`Renderer failed to load ${url}: ${code} ${description}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process exited:', details);
  });
  if (options.logRendererConsole) {
    window.webContents.on('console-message', (details) => {
      if (details.level === 'warning' || details.level === 'error') {
        console.error(`[Renderer ${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
      }
    });
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
