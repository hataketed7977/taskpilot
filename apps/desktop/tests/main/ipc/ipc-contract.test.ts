import { describe, expect, it, vi } from 'vitest';
import { CHANNELS, registerDesktopHandlers, validateIpcEvent } from '../../../src/main/ipc.js';

const trusted = { sender: { id: 7 }, senderFrame: { url: 'file:///app/index.html', parent: null } };

describe('Desktop IPC boundary', () => {
  it('rejects wrong sender, child frame, origin and stale session generation', () => {
    expect(() => validateIpcEvent({ ...trusted, sender: { id: 8 } }, { webContentsId: 7, generation: 2 }, 2)).toThrow();
    expect(() => validateIpcEvent({ ...trusted, senderFrame: { url: 'https://evil.test', parent: null } }, { webContentsId: 7, generation: 2 }, 2)).toThrow();
    expect(() => validateIpcEvent(trusted, { webContentsId: 7, generation: 2 }, 1)).toThrow();
  });

  it('accepts only the fixed development Renderer origin when explicitly scoped', () => {
    const development = { sender: { id: 7 }, senderFrame: { url: 'http://127.0.0.1:5173/login', parent: null } };
    expect(() => validateIpcEvent(development, { webContentsId: 7, generation: 1, rendererOrigin: 'http://127.0.0.1:5173' }, 1)).not.toThrow();
    expect(() => validateIpcEvent(
      { ...development, senderFrame: { url: 'http://localhost:5173/login', parent: null } },
      { webContentsId: 7, generation: 1, rendererOrigin: 'http://127.0.0.1:5173' },
      1,
    )).toThrow();
  });

  it('registers only explicit capability channels and no generic transport or token getter', () => {
    const registered: string[] = [];
    const ipc = { handle: (channel: string) => registered.push(channel), removeHandler: vi.fn() };
    const dispose = registerDesktopHandlers(ipc, { auth: {}, workspaces: {}, projects: {} } as never, { webContentsId: 7, generation: 1 });
    const expected = Object.values(CHANNELS).filter(channel => channel !== CHANNELS.sessionChanged).sort();
    expect(registered.sort()).toEqual(expected);
    expect(registered.join(' ')).not.toMatch(/http|token|getToken|invoke|send/i);
    dispose();
    expect(ipc.removeHandler.mock.calls.map(([channel]) => channel).sort()).toEqual(expected);
  });
});
