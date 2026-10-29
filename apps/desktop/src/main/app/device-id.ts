import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export async function stableDeviceId(path: string): Promise<string> {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    const value = randomUUID();
    await writeFile(path, value, { mode: 0o600 });
    return value;
  }
}
