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
    expect(value).toContain('will-navigate');
    expect(value).toContain('setWindowOpenHandler');
    expect(value).toContain('setPermissionRequestHandler');
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
