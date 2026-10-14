import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonRecentProjectStore, MemoryRecentProjectStore } from '../../src/main/projects/recent-project-store.js';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const projectA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('recent Project preference', () => {
  it('partitions preferences by environment and User', async () => {
    const store = new MemoryRecentProjectStore();
    await store.save('local', userA, projectA);
    expect(await store.load('local', userA)).toBe(projectA);
    expect(await store.load('production', userA)).toBeUndefined();
    expect(await store.load('local', userB)).toBeUndefined();
  });

  it('persists only validated identifiers and degrades corrupted storage to no preference', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'taskpilot-project-preference-'));
    const path = join(directory, 'recent-projects.json');
    const store = new JsonRecentProjectStore(path);
    await store.save('production', userA, projectA);
    expect(await store.load('production', userA)).toBe(projectA);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      entries: { [`production:${userA}`]: projectA },
    });

    await writeFile(path, '{corrupted');
    await expect(store.load('production', userA)).resolves.toBeUndefined();
  });
});
