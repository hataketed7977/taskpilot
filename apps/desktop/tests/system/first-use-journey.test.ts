import { describe, expect, it } from 'vitest';
import { FixedHttpTransport } from '../../src/main/api/transport.js';
import { MemoryFederatedAuthRecoveryStore } from '../../src/main/auth/auth-recovery-store.js';
import { createDesktopComposition } from '../../src/main/composition.js';
import { MemoryCredentialStore } from '../../src/main/credentials/credential-store.js';
import { registerDesktopHandlers } from '../../src/main/ipc.js';
import { createTaskPilotDesktopApi } from '../../src/preload/api.js';

const baseUrl = process.env.TASKPILOT_SYSTEM_BASE_URL;
const trustedEvent = { sender: { id: 71 }, senderFrame: { url: 'file:///taskpilot/index.html', parent: null } };

interface Handler {
  (event: typeof trustedEvent, input?: unknown): unknown;
}

class MemoryIpc {
  private readonly handlers = new Map<string, Handler>();
  handle(channel: string, listener: Handler): void { this.handlers.set(channel, listener); }
  removeHandler(channel: string): void { this.handlers.delete(channel); }
  async invoke(channel: string, input?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
    return handler(trustedEvent, input);
  }
}

describe('Desktop local system boundary', () => {
  it('crosses Main, Preload, IPC and Core API while GitHub is fail-closed', async () => {
    if (!baseUrl) throw new Error('TASKPILOT_SYSTEM_BASE_URL is required');
    const health = await fetch(`${baseUrl}/actuator/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'UP' });

    const composition = createDesktopComposition({
      environment: 'local',
      transport: new FixedHttpTransport('local', fetch, baseUrl),
      credentials: new MemoryCredentialStore(),
      authRecovery: new MemoryFederatedAuthRecoveryStore(),
      deviceInstallationId: 'system-journey-device',
      browser: { open: async () => { throw new Error('Fail-closed smoke must not open GitHub'); } },
    });
    expect(Object.keys(composition.capabilities)).toEqual(['auth']);
    expect(composition).not.toHaveProperty('runtime');

    const ipc = new MemoryIpc();
    const dispose = registerDesktopHandlers(ipc, composition.capabilities, { webContentsId: 71, generation: 1 });
    try {
      const api = createTaskPilotDesktopApi(async (channel, input) => {
        const result = await ipc.invoke(channel, input);
        if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === false) {
          throw new Error(`System IPC ${channel} failed`);
        }
        return result;
      }, () => () => undefined);

      expect(await api.auth.getCapabilities()).toEqual({ github: { enabled: false } });
      expect((await api.auth.getSessionView()).status).toBe('signedOut');
      const retired = await fetch(`${baseUrl}/desktop/v1/auth/login/code`);
      expect(retired.status).toBe(404);
    } finally {
      dispose();
    }
  });
});
