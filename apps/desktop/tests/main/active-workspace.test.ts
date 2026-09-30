import { describe, expect, it } from 'vitest';
import { ActiveWorkspaceStore, MemoryPreferenceStore } from '../../src/main/workspaces/active-workspace.js';
const items = [
  { workspaceId: '11111111-1111-4111-8111-111111111111', name: 'One', type: 'ORGANIZATION' as const },
  { workspaceId: '22222222-2222-4222-8222-222222222222', name: 'Two', type: 'ORGANIZATION' as const },
];
describe('ActiveWorkspaceStore', () => {
  it('auto-selects one workspace, restores authorized recent selection, and clears revoked selection', async () => {
    const preferences = new MemoryPreferenceStore(); const store = new ActiveWorkspaceStore(preferences);
    await expect(store.restore('production', 'user-a', items.slice(0, 1))).resolves.toBe(items[0].workspaceId);
    await store.select('production', 'user-a', items[1].workspaceId);
    await expect(store.restore('production', 'user-a', items)).resolves.toBe(items[1].workspaceId);
    await expect(store.restore('production', 'user-a', items.slice(0, 1))).resolves.toBeUndefined();
  });
  it('does not cross account or environment boundaries and does not choose among N automatically', async () => {
    const preferences = new MemoryPreferenceStore(); const store = new ActiveWorkspaceStore(preferences);
    await store.select('production', 'user-a', items[0].workspaceId);
    await expect(store.restore('production', 'user-b', items)).resolves.toBeUndefined();
    await expect(store.restore('local', 'user-a', items)).resolves.toBeUndefined();
  });
});
