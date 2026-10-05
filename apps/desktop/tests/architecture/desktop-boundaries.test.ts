import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const source = (path: string) => readFile(resolve(root, path), 'utf8');

describe('Desktop process boundary', () => {
  it('hardens BrowserWindow and denies navigation, popups and permissions', async () => {
    const value = await source('src/main/index.ts');
    expect(value).toMatch(/contextIsolation:\s*true/);
    expect(value).toMatch(/sandbox:\s*true/);
    expect(value).toMatch(/nodeIntegration:\s*false/);
    expect(value).toMatch(/minWidth:\s*960/);
    expect(value).toMatch(/minHeight:\s*640/);
    expect(value).toContain("preload: join(here, '../preload/index.cjs')");
    expect(value).toContain('will-navigate');
    expect(value).toContain('setWindowOpenHandler');
    expect(value).toContain('setPermissionRequestHandler');
  });

  it('bundles the sandboxed Preload as one CommonJS entrypoint', async () => {
    const value = await source('vite.preload.config.ts');
    expect(value).toContain("formats: ['cjs']");
    expect(value).toContain("fileName: () => 'index.cjs'");
    expect(value).toContain("external: ['electron']");
  });

  it('keeps the development server loopback-only without weakening production content policy', async () => {
    const [main, location, vite] = await Promise.all([
      source('src/main/index.ts'),
      source('src/main/renderer-location.ts'),
      source('vite.config.ts'),
    ]);
    expect(location).toContain("http://127.0.0.1:5173");
    expect(location).toContain("parsed.hostname === '127.0.0.1'");
    expect(location).not.toContain('0.0.0.0');
    expect(main).toContain('TASKPILOT_DESKTOP_DEV_SERVER_URL');
    expect(main).toContain('TASKPILOT_CORE_API_URL');
    expect(main).toContain('window.loadURL(renderer.url)');
    expect(vite).toContain("command === 'serve'");
    expect(vite).toContain('TASKPILOT_DESKTOP_DEV_SERVER_PORT');
    expect(vite).toContain('ws://127.0.0.1:${developmentPort}');
  });

  it('keeps React Fast Refresh enabled after the initial Preload build', async () => {
    const value = await source('scripts/dev.mjs');
    expect(value).toContain("process.env.NODE_ENV = 'development'");
    expect(value).toContain('const nodeEnvironment = process.env.NODE_ENV');
    expect(value).toContain('delete process.env.NODE_ENV');
  });

  it('exposes only capability methods and never generic IPC, Electron or credentials', async () => {
    const [entrypoint, surface] = await Promise.all([source('src/preload/index.ts'), source('src/preload/api.ts')]);
    expect(entrypoint).toContain("contextBridge.exposeInMainWorld('taskpilot'");
    expect(entrypoint).not.toMatch(/exposeInMainWorld\([^)]*(ipcRenderer|electron)|\b(send|invoke|fetch|accessToken|refreshToken)\s*:/s);
    expect(surface).toContain('subscribeSessionView');
    expect(surface).toContain('listWorkspaces');
    expect(surface).toContain('listProjects');
    expect(surface).not.toMatch(/from ['"]electron['"]|accessToken|refreshToken|\bfetch\s*\(/);
  });

  it('keeps Renderer free of Node, Electron, HTTP and Runtime imports', async () => {
    const [app, main] = await Promise.all([source('src/renderer/App.tsx'), source('src/renderer/main.tsx')]);
    expect(`${app}\n${main}`).not.toMatch(/from ['"](?:node:|electron)|\bfetch\s*\(|agent-runtime|runtime:/i);
  });

  it('keeps long user-controlled names inside shrinkable layout regions', async () => {
    const value = await source('src/renderer/styles.css');
    expect(value).toMatch(/\.workspace-name[^}]*min-width:\s*0/);
    expect(value).toMatch(/\.project-copy[^}]*min-width:\s*0/);
    expect(value).toMatch(/\.user-content[^}]*overflow-wrap:\s*anywhere/);
  });

  it('uses width-based zoom resilience and honors reduced motion', async () => {
    const value = await source('src/renderer/styles.css');
    expect(value).not.toContain('@media(zoom');
    expect(value).toMatch(/@media\(max-width:\s*720px\)/);
    expect(value).toMatch(/@media\(prefers-reduced-motion:\s*reduce\)/);
  });

});
