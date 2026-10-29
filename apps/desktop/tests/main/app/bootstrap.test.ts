import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown;
  type FakeWindow = {
    webContents: { id: number; send: ReturnType<typeof vi.fn> };
    isDestroyed: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    handlers: Map<string, Handler>;
  };

  const state = {
    window: undefined as FakeWindow | undefined,
    renderer: { kind: 'dev-server', origin: 'http://127.0.0.1:5173' } as { kind: 'dev-server'; origin: string } | { kind: 'packaged-file' },
    load: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    unsubscribe: vi.fn(),
    sessionObserver: undefined as ((view: unknown) => void) | undefined,
    compositionOptions: undefined as Record<string, unknown> | undefined,
  };

  const makeWindow = (): FakeWindow => {
    const handlers = new Map<string, Handler>();
    return {
      webContents: { id: 42, send: vi.fn() },
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
      handlers,
    };
  };

  const session = {
    subscribe: vi.fn((observer: (view: unknown) => void) => {
      state.sessionObserver = observer;
      return state.unsubscribe;
    }),
    restore: vi.fn().mockResolvedValue(undefined),
  };
  const federatedAuth = {
    restore: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const capabilities = { auth: {}, projects: {}, boards: {}, workspaces: {} };

  return {
    state,
    makeWindow,
    app: { isPackaged: false, getPath: vi.fn(() => '/user-data') },
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
    AsyncEntry: vi.fn(function AsyncEntry(service: string, account: string) {
      return { service, account };
    }),
    FixedHttpTransport: vi.fn(function FixedHttpTransport(environment: string, fetchImpl: typeof fetch, baseUrl?: string) {
      return { kind: 'transport', environment, fetchImpl, baseUrl };
    }),
    KeyringFederatedAuthRecoveryStore: vi.fn(function KeyringFederatedAuthRecoveryStore(createEntry: unknown) {
      return { kind: 'authRecovery', createEntry };
    }),
    KeyringCredentialStore: vi.fn(function KeyringCredentialStore(createEntry: unknown) {
      return { kind: 'credentials', createEntry };
    }),
    JsonRecentProjectStore: vi.fn(function JsonRecentProjectStore(path: string) {
      return { kind: 'recentProjects', path };
    }),
    JsonRecentBoardStore: vi.fn(function JsonRecentBoardStore(path: string) {
      return { kind: 'recentBoards', path };
    }),
    createDesktopWindow: vi.fn(() => {
      if (!state.window) state.window = makeWindow();
      return { window: state.window, renderer: state.renderer, load: state.load };
    }),
    stableDeviceId: vi.fn().mockResolvedValue('device-installation-id'),
    createDesktopComposition: vi.fn((options: Record<string, unknown>) => {
      state.compositionOptions = options;
      return { capabilities, session, federatedAuth };
    }),
    registerDesktopHandlers: vi.fn(() => state.dispose),
    CHANNELS: { sessionChanged: 'sessionChanged' },
    session,
    federatedAuth,
    capabilities,
  };
});

vi.mock('electron', () => ({ app: mock.app, ipcMain: mock.ipcMain, shell: mock.shell }));
vi.mock('@napi-rs/keyring', () => ({ AsyncEntry: mock.AsyncEntry }));
vi.mock('../../../src/main/api/transport.js', () => ({ FixedHttpTransport: mock.FixedHttpTransport }));
vi.mock('../../../src/main/auth/auth-recovery-store.js', () => ({ KeyringFederatedAuthRecoveryStore: mock.KeyringFederatedAuthRecoveryStore }));
vi.mock('../../../src/main/composition.js', () => ({ createDesktopComposition: mock.createDesktopComposition }));
vi.mock('../../../src/main/credentials/credential-store.js', () => ({ KeyringCredentialStore: mock.KeyringCredentialStore }));
vi.mock('../../../src/main/ipc.js', () => ({ CHANNELS: mock.CHANNELS, registerDesktopHandlers: mock.registerDesktopHandlers }));
vi.mock('../../../src/main/projects/recent-board-store.js', () => ({ JsonRecentBoardStore: mock.JsonRecentBoardStore }));
vi.mock('../../../src/main/projects/recent-project-store.js', () => ({ JsonRecentProjectStore: mock.JsonRecentProjectStore }));
vi.mock('../../../src/main/app/create-window.js', () => ({ createDesktopWindow: mock.createDesktopWindow }));
vi.mock('../../../src/main/app/device-id.js', () => ({ stableDeviceId: mock.stableDeviceId }));

const { bootstrapDesktopApp } = await import('../../../src/main/app/bootstrap.js');

async function flushRestoreChain(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('bootstrapDesktopApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.app.isPackaged = false;
    mock.app.getPath.mockReturnValue('/user-data');
    mock.state.window = mock.makeWindow();
    mock.state.renderer = { kind: 'dev-server', origin: 'http://127.0.0.1:5173' };
    mock.state.load.mockResolvedValue(undefined);
    mock.state.dispose = vi.fn();
    mock.state.unsubscribe = vi.fn();
    mock.state.sessionObserver = undefined;
    mock.state.compositionOptions = undefined;
    mock.session.subscribe.mockImplementation((observer: (view: unknown) => void) => {
      mock.state.sessionObserver = observer;
      return mock.state.unsubscribe;
    });
    mock.session.restore.mockResolvedValue(undefined);
    mock.federatedAuth.restore.mockResolvedValue(undefined);
    mock.federatedAuth.close.mockResolvedValue(undefined);
    mock.registerDesktopHandlers.mockImplementation(() => mock.state.dispose);
    process.env.TASKPILOT_DESKTOP_DEV_SERVER_URL = 'http://127.0.0.1:5173';
    process.env.TASKPILOT_CORE_API_URL = 'http://127.0.0.1:8080';
  });

  it('wires the local Desktop composition, IPC boundary and startup restore in order', async () => {
    await bootstrapDesktopApp();
    await flushRestoreChain();

    expect(mock.createDesktopWindow).toHaveBeenCalledWith(expect.objectContaining({
      isPackaged: false,
      devServerUrl: 'http://127.0.0.1:5173',
    }));
    expect(mock.FixedHttpTransport).toHaveBeenCalledWith('local', fetch, 'http://127.0.0.1:8080');
    expect(mock.stableDeviceId).toHaveBeenCalledWith('/user-data/device-installation-id');
    expect(mock.JsonRecentProjectStore).toHaveBeenCalledWith('/user-data/recent-projects.json');
    expect(mock.JsonRecentBoardStore).toHaveBeenCalledWith('/user-data/recent-boards.json');
    expect(mock.createDesktopComposition).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'local',
      deviceInstallationId: 'device-installation-id',
    }));
    expect(mock.registerDesktopHandlers).toHaveBeenCalledWith(mock.ipcMain, mock.capabilities, {
      webContentsId: 42,
      generation: 1,
      rendererOrigin: 'http://127.0.0.1:5173',
    });
    expect(mock.session.subscribe).toHaveBeenCalledWith(expect.any(Function));
    expect(mock.state.window?.on).toHaveBeenCalledWith('closed', expect.any(Function));
    expect(mock.state.load).toHaveBeenCalledOnce();
    expect(mock.state.load.mock.invocationCallOrder[0]).toBeLessThan(mock.federatedAuth.restore.mock.invocationCallOrder[0]);
    expect(mock.session.restore).toHaveBeenCalledOnce();
  });

  it('keeps session fanout, activation, browser handoff and window-close cleanup owned by the bootstrap boundary', async () => {
    await bootstrapDesktopApp();

    await (mock.state.compositionOptions?.browser as { open(url: string): Promise<void> }).open('https://github.com/login/oauth/authorize');
    expect(mock.shell.openExternal).toHaveBeenCalledWith('https://github.com/login/oauth/authorize', { activate: true });

    (mock.state.compositionOptions?.activateDesktop as () => void)();
    expect(mock.state.window?.restore).toHaveBeenCalledOnce();
    expect(mock.state.window?.show).toHaveBeenCalledOnce();
    expect(mock.state.window?.focus).toHaveBeenCalledOnce();

    const signedOut = { status: 'signedOut' };
    mock.state.sessionObserver?.(signedOut);
    expect(mock.state.window?.webContents.send).toHaveBeenCalledWith('sessionChanged', signedOut);

    mock.state.window?.isDestroyed.mockReturnValue(true);
    mock.state.sessionObserver?.({ status: 'restoring' });
    expect(mock.state.window?.webContents.send).toHaveBeenCalledTimes(1);

    mock.state.window?.handlers.get('closed')?.();
    expect(mock.federatedAuth.close).toHaveBeenCalledOnce();
    expect(mock.state.dispose).toHaveBeenCalledOnce();
    expect(mock.state.unsubscribe).toHaveBeenCalledOnce();
  });

  it('omits local-only API and renderer-origin overrides for packaged production startup', async () => {
    mock.app.isPackaged = true;
    mock.state.renderer = { kind: 'packaged-file' };
    delete process.env.TASKPILOT_CORE_API_URL;

    await bootstrapDesktopApp();

    expect(mock.createDesktopWindow).toHaveBeenCalledWith(expect.objectContaining({ isPackaged: true }));
    expect(mock.FixedHttpTransport).toHaveBeenCalledWith('production', fetch, undefined);
    expect(mock.createDesktopComposition).toHaveBeenCalledWith(expect.objectContaining({ environment: 'production' }));
    expect(mock.registerDesktopHandlers).toHaveBeenCalledWith(mock.ipcMain, mock.capabilities, {
      webContentsId: 42,
      generation: 1,
      rendererOrigin: undefined,
    });
  });
});
