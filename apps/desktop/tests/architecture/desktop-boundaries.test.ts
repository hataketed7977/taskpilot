import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const source = (path: string) => readFile(resolve(root, path), 'utf8');

describe('Desktop process boundary', () => {
  it('hardens BrowserWindow and denies navigation, popups and permissions', async () => {
    const value = `${await source('src/main/app/create-window.ts')}
${await source('src/main/app/window-security.ts')}
${await source('src/main/app/bootstrap.ts')}`;
    expect(value).toMatch(/contextIsolation:\s*true/);
    expect(value).toMatch(/sandbox:\s*true/);
    expect(value).toMatch(/nodeIntegration:\s*false/);
    expect(value).toMatch(/minWidth:\s*960/);
    expect(value).toMatch(/minHeight:\s*640/);
    expect(value).toContain("preload: join(options.here, '../../preload/index.cjs')");
    expect(value).toContain('will-navigate');
    expect(value).toContain('setWindowOpenHandler');
    expect(value).toContain('setPermissionRequestHandler');
    expect(value).toContain('if (window.isMinimized()) window.restore()');
    expect(value).toContain('window.show()');
    expect(value).toContain('window.focus()');
  });

  it('bundles the sandboxed Preload as one CommonJS entrypoint', async () => {
    const value = await source('vite.preload.config.ts');
    expect(value).toContain("formats: ['cjs']");
    expect(value).toContain("fileName: () => 'index.cjs'");
    expect(value).toContain("external: ['electron']");
  });

  it('keeps the development server loopback-only without weakening production content policy', async () => {
    const [windowFactory, bootstrap, location, vite] = await Promise.all([
      source('src/main/app/create-window.ts'),
      source('src/main/app/bootstrap.ts'),
      source('src/main/renderer-location.ts'),
      source('vite.config.ts'),
    ]);
    expect(location).toContain("http://127.0.0.1:5173");
    expect(location).toContain("parsed.hostname === '127.0.0.1'");
    expect(location).not.toContain('0.0.0.0');
    expect(bootstrap).toContain('TASKPILOT_DESKTOP_DEV_SERVER_URL');
    expect(bootstrap).toContain('TASKPILOT_CORE_API_URL');
    expect(windowFactory).toContain('window.loadURL(renderer.url)');
    expect(vite).toContain("command === 'serve'");
    expect(vite).toContain('TASKPILOT_DESKTOP_DEV_SERVER_PORT');
    expect(vite).toContain('ws://127.0.0.1:${developmentPort}');
  });

  it('allows only the trusted GitHub avatar host for remote Renderer images', async () => {
    const value = await source('src/renderer/index.html');
    const policy = value.match(/Content-Security-Policy" content="([^"]+)"/)?.[1];
    expect(policy).toContain("img-src 'self' data: https://avatars.githubusercontent.com;");
    expect(policy).not.toMatch(/img-src[^;]*\shttps:([;\s]|$)|img-src[^;]*\*/);
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
    expect(surface).toContain('startGitHubSignIn');
    expect(surface).toContain('completeGitHubRegistration');
    expect(surface).toContain('workspaces:');
    expect(surface).toContain('projects:');
    expect(surface).toContain('resolveHome');
    expect(surface).toContain('permanentlyDelete');
    expect(surface).not.toMatch(/generic|requestUrl|httpRequest|getAccessToken|getRefreshToken/);
    expect(surface).not.toMatch(/from ['"]electron['"]|accessToken|refreshToken|\bfetch\s*\(/);
  });

  it('keeps Renderer free of Node, Electron, HTTP and Runtime imports', async () => {
    const [app, main] = await Promise.all([source('src/renderer/app/App.tsx'), source('src/renderer/app/main.tsx')]);
    expect(`${app}\n${main}`).not.toMatch(/from ['"](?:node:|electron)|\bfetch\s*\(|agent-runtime|runtime:/i);
  });

  it('keeps localization static, text-only and inside the Renderer boundary', async () => {
    const [factory, provider, state, locale, ...messageFiles] = await Promise.all([
      source('src/renderer/i18n/i18n.ts'),
      source('src/renderer/i18n/locale-context.tsx'),
      source('src/renderer/i18n/locale-state.ts'),
      source('src/renderer/i18n/locale.ts'),
      source('src/renderer/i18n/messages/index.ts'),
      source('src/renderer/i18n/messages/language.ts'),
      source('src/renderer/i18n/messages/common.ts'),
      source('src/renderer/i18n/messages/session.ts'),
      source('src/renderer/i18n/messages/auth.ts'),
      source('src/renderer/i18n/messages/legal.ts'),
      source('src/renderer/i18n/messages/account.ts'),
      source('src/renderer/i18n/messages/project.ts'),
      source('src/renderer/i18n/messages/board.ts'),
      source('src/renderer/i18n/messages/detail.ts'),
    ]);
    const localization = `${factory}
${provider}
${state}
${locale}
${messageFiles.join('\n')}`;
    expect(localization).not.toMatch(/from ['"](?:node:|electron)|\bfetch\s*\(|https?:\/\/|ipcRenderer|window\.taskpilot/i);
    expect(localization).not.toMatch(/i18next-http-backend|i18next-fs-backend|BackendModule/);
    expect(localization).not.toContain('dangerouslySetInnerHTML');
    expect(factory).toContain('resources');
    expect(factory).toContain("fallbackLng: 'en'");
  });

  it('keeps long user-controlled names inside shrinkable layout regions', async () => {
    const value = `${await source('src/renderer/styles/index.css')}\n${await source('src/renderer/styles/auth.css')}\n${await source('src/renderer/styles/shell.css')}\n${await source('src/renderer/styles/board.css')}\n${await source('src/renderer/styles/detail.css')}\n${await source('src/renderer/styles/shared-ui.css')}`;
    expect(value).toMatch(/\.user-content[^}]*overflow-wrap:\s*anywhere/);
  });

  it('uses width-based zoom resilience and honors reduced motion', async () => {
    const value = `${await source('src/renderer/styles/index.css')}\n${await source('src/renderer/styles/auth.css')}\n${await source('src/renderer/styles/shell.css')}\n${await source('src/renderer/styles/board.css')}\n${await source('src/renderer/styles/detail.css')}\n${await source('src/renderer/styles/shared-ui.css')}`;
    expect(value).not.toContain('@media(zoom');
    expect(value).toMatch(/@media\s*\(\s*max-width:\s*760px\s*\)/);
    expect(value).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
  });

});
