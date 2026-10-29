import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { stableDeviceId } from '../../../src/main/app/device-id.js';

describe('stableDeviceId', () => {
  it('creates a private stable device id when no file exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskpilot-device-id-'));
    const path = join(dir, 'device-installation-id');

    const created = await stableDeviceId(path);
    const loaded = await stableDeviceId(path);

    expect(created).toMatch(/^[0-9a-f-]{36}$/i);
    expect(loaded).toBe(created);
    await expect(readFile(path, 'utf8')).resolves.toBe(created);
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
