import type { WorkspaceItem } from '../../shared/contracts.js';
import type { Environment } from '../api/transport.js';
export interface PreferenceStore { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> }
export class MemoryPreferenceStore implements PreferenceStore { private values = new Map<string, string>(); async get(key: string) { return this.values.get(key); } async set(key: string, value: string) { this.values.set(key, value); } async delete(key: string) { this.values.delete(key); } }
export class ActiveWorkspaceStore {
  constructor(private readonly preferences: PreferenceStore) {}
  async restore(environment: Environment, userId: string, available: WorkspaceItem[]): Promise<string | undefined> {
    const key = this.key(environment, userId); const recent = await this.preferences.get(key);
    if (recent) { if (available.some(item => item.workspaceId === recent)) return recent; await this.preferences.delete(key); return undefined; }
    if (available.length === 1) { await this.preferences.set(key, available[0].workspaceId); return available[0].workspaceId; }
    return undefined;
  }
  select(environment: Environment, userId: string, workspaceId: string): Promise<void> { return this.preferences.set(this.key(environment, userId), workspaceId); }
  clear(environment: Environment, userId: string): Promise<void> { return this.preferences.delete(this.key(environment, userId)); }
  private key(environment: Environment, userId: string) { return `active-workspace:${environment}:${userId}`; }
}
