import { describe, expect, it, vi } from 'vitest';

const browserWindow = vi.fn();
type MockWindow = {
  options: unknown;
  webContents: {
    id: number;
    on: ReturnType<typeof vi.fn>;
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
    session: { setPermissionRequestHandler: ReturnType<typeof vi.fn> };
  };
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  __handlers: Map<string, (...args: unknown[]) => unknown>;
};

const createdWindows: MockWindow[] = [];

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(function BrowserWindowMock(options) {
    browserWindow(options);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const window = {
      options,
      webContents: {
        id: 42,
        on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => handlers.set(event, handler)),
        setWindowOpenHandler: vi.fn(),
        session: { setPermissionRequestHandler: vi.fn() },
      },
      loadURL: vi.fn().mockResolvedValue(undefined),
      loadFile: vi.fn().mockResolvedValue(undefined),
      __handlers: handlers,
    };
    createdWindows.push(window);
    return window;
  }),
}));

const { createDesktopWindow } = await import('../../../src/main/app/create-window.js');

describe('createDesktopWindow', () => {
  it('creates a hardened BrowserWindow and denies navigation, popups and permissions', async () => {
    const handle = createDesktopWindow({ isPackaged: false, here: '/app/dist/main/app', devServerUrl: 'http://127.0.0.1:5173' });
    const window = createdWindows.at(-1)!;

    expect(browserWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 1180,
      height: 760,
      minWidth: 960,
      minHeight: 640,
      webPreferences: expect.objectContaining({
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        preload: '/app/dist/preload/index.cjs',
      }),
    }));
    expect(window.webContents.on).toHaveBeenCalledWith('will-navigate', expect.any(Function));
    expect(window.webContents.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(window.webContents.session.setPermissionRequestHandler).toHaveBeenCalledWith(expect.any(Function));

    const event = { preventDefault: vi.fn() };
    window.__handlers.get('will-navigate')?.(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(window.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    const permissionCallback = vi.fn();
    window.webContents.session.setPermissionRequestHandler.mock.calls[0][0](undefined, 'camera', permissionCallback);
    expect(permissionCallback).toHaveBeenCalledWith(false);

    await handle.load();
    expect(window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173');
  });

  it('loads packaged renderer files for production', async () => {
    const handle = createDesktopWindow({ isPackaged: true, here: '/app/dist/main/app', devServerUrl: 'http://127.0.0.1:5173' });
    const window = createdWindows.at(-1)!;

    await handle.load();

    expect(handle.renderer).toEqual({ kind: 'packaged-file' });
    expect(window.loadFile).toHaveBeenCalledWith('/app/dist/renderer/index.html');
  });
});
