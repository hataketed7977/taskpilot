import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Environment } from '../api/transport.js';

const uuid = z.string().uuid();
const documentSchema = z.object({ version: z.literal(1), entries: z.record(z.string(), uuid) }).strict();
type PreferenceDocument = z.infer<typeof documentSchema>;

export interface RecentBoardStore {
  load(environment: Environment, userId: string, workspaceId: string, projectId: string): Promise<string | undefined>;
  save(environment: Environment, userId: string, workspaceId: string, projectId: string, boardId: string): Promise<void>;
  clear(environment: Environment, userId: string, workspaceId: string, projectId: string): Promise<void>;
}

const keyOf = (environment: Environment, userId: string, workspaceId: string, projectId: string) =>
  `${environment}:${uuid.parse(userId)}:${uuid.parse(workspaceId)}:${uuid.parse(projectId)}`;

export class JsonRecentBoardStore implements RecentBoardStore {
  private mutation: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}

  async load(environment: Environment, userId: string, workspaceId: string, projectId: string) {
    return (await this.read()).entries[keyOf(environment, userId, workspaceId, projectId)];
  }
  save(environment: Environment, userId: string, workspaceId: string, projectId: string, boardId: string) {
    return this.mutate(document => { document.entries[keyOf(environment, userId, workspaceId, projectId)] = uuid.parse(boardId); });
  }
  clear(environment: Environment, userId: string, workspaceId: string, projectId: string) {
    return this.mutate(document => { delete document.entries[keyOf(environment, userId, workspaceId, projectId)]; });
  }
  private mutate(change: (document: PreferenceDocument) => void): Promise<void> {
    const result = this.mutation.then(async () => {
      const document = await this.read();
      change(document);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.path);
    });
    this.mutation = result.catch(() => undefined);
    return result;
  }
  private async read(): Promise<PreferenceDocument> {
    try { return documentSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch { return { version: 1, entries: {} }; }
  }
}

export class MemoryRecentBoardStore implements RecentBoardStore {
  private readonly entries = new Map<string, string>();
  async load(environment: Environment, userId: string, workspaceId: string, projectId: string) { return this.entries.get(keyOf(environment, userId, workspaceId, projectId)); }
  async save(environment: Environment, userId: string, workspaceId: string, projectId: string, boardId: string) { this.entries.set(keyOf(environment, userId, workspaceId, projectId), uuid.parse(boardId)); }
  async clear(environment: Environment, userId: string, workspaceId: string, projectId: string) { this.entries.delete(keyOf(environment, userId, workspaceId, projectId)); }
}
