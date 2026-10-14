import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Environment } from '../api/transport.js';

const uuid = z.string().uuid();
const documentSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), uuid),
}).strict();
type PreferenceDocument = z.infer<typeof documentSchema>;

export interface RecentProjectStore {
  load(environment: Environment, userId: string): Promise<string | undefined>;
  save(environment: Environment, userId: string, projectId: string): Promise<void>;
  clear(environment: Environment, userId: string): Promise<void>;
}

const keyOf = (environment: Environment, userId: string) => `${environment}:${uuid.parse(userId)}`;

export class JsonRecentProjectStore implements RecentProjectStore {
  private mutation: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}

  async load(environment: Environment, userId: string): Promise<string | undefined> {
    return (await this.read()).entries[keyOf(environment, userId)];
  }

  save(environment: Environment, userId: string, projectId: string): Promise<void> {
    return this.mutate(async document => {
      document.entries[keyOf(environment, userId)] = uuid.parse(projectId);
    });
  }

  clear(environment: Environment, userId: string): Promise<void> {
    return this.mutate(async document => {
      delete document.entries[keyOf(environment, userId)];
    });
  }

  private mutate(change: (document: PreferenceDocument) => Promise<void>): Promise<void> {
    const result = this.mutation.then(async () => {
      const document = await this.read();
      await change(document);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.path);
    });
    this.mutation = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<PreferenceDocument> {
    try {
      return documentSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch {
      return { version: 1, entries: {} };
    }
  }
}

export class MemoryRecentProjectStore implements RecentProjectStore {
  private readonly entries = new Map<string, string>();
  async load(environment: Environment, userId: string) { return this.entries.get(keyOf(environment, userId)); }
  async save(environment: Environment, userId: string, projectId: string) { this.entries.set(keyOf(environment, userId), uuid.parse(projectId)); }
  async clear(environment: Environment, userId: string) { this.entries.delete(keyOf(environment, userId)); }
}
