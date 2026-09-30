import { z } from 'zod';
import type { WorkspaceItem, WorkspaceList } from '../../shared/contracts.js';
import type { HttpTransport } from '../api/transport.js';
import { OutcomeUnknownError } from '../api/transport.js';
import type { SessionCoordinator } from '../session/session-coordinator.js';
const workspace = z.object({ workspaceId: z.string().uuid(), name: z.string(), type: z.enum(['ORGANIZATION', 'PERSONAL']) }).strict();
const workspaceList = z.object({ items: z.array(workspace), capabilities: z.object({ canCreateWorkspace: z.boolean(), createWorkspaceReasonCode: z.string().optional() }).strict() }).strict();
export class WorkspaceResultUnknownError extends Error { readonly code = 'WORKSPACE_RESULT_UNKNOWN'; readonly recovery = 'RETRY'; }
export class WorkspaceClient {
  constructor(private readonly transport: HttpTransport, private readonly session: SessionCoordinator) {}
  list(): Promise<WorkspaceList> { return this.session.protected(async accessToken => workspaceList.parse(await this.transport.request({ method: 'GET', path: '/desktop/v1/workspaces', accessToken }))); }
  async create(input: { name: string; creationRequestId: string }): Promise<WorkspaceItem> {
    try {
      return await this.session.protected(async accessToken => workspace.parse(await this.transport.request({ method: 'POST', path: '/desktop/v1/workspaces', accessToken, idempotencyKey: input.creationRequestId, body: { name: input.name }, outcomeUnknownOnNetworkFailure: true })));
    } catch (error) {
      if (error instanceof OutcomeUnknownError) throw new WorkspaceResultUnknownError();
      throw error;
    }
  }
}
