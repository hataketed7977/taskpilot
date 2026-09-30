import { z } from 'zod';
import type { ProjectPage } from '../../shared/contracts.js';
import type { Environment, HttpTransport } from '../api/transport.js';
import type { SessionCoordinator } from '../session/session-coordinator.js';
const uuid = z.string().uuid();
const pageSchema = z.object({ items: z.array(z.object({ projectId: uuid, workspaceId: uuid, name: z.string() }).strict()), nextCursor: z.string().optional() }).strict();
export class ProjectScopeError extends Error { readonly code = 'PROJECT_SCOPE_MISMATCH'; }
export function projectQueryKey(environment: Environment, userId: string, workspaceId: string): string { return `${environment}:${userId}:${workspaceId}`; }
export class ProjectClient {
  constructor(private readonly transport: HttpTransport, private readonly session: SessionCoordinator) {}
  list(input: { workspaceId: string; cursor?: string; limit?: number }): Promise<ProjectPage> {
    uuid.parse(input.workspaceId); const limit = input.limit ?? 50; if (limit < 1 || limit > 100) throw new Error('VALIDATION_FAILED');
    const query = new URLSearchParams(); if (input.cursor) query.set('cursor', input.cursor); query.set('limit', String(limit));
    const path = `/desktop/v1/workspaces/${input.workspaceId}/projects?${query.toString()}`;
    return this.session.protected(async accessToken => {
      const page = pageSchema.parse(await this.transport.request({ method: 'GET', path, accessToken }));
      if (page.items.some(item => item.workspaceId !== input.workspaceId)) throw new ProjectScopeError();
      return page;
    });
  }
}
