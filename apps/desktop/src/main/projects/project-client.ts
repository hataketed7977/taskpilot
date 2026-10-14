import { z } from 'zod';
import type {
  CreateProjectInput,
  DeleteProjectInput,
  EditProjectInput,
  PersonalWorkspaceView,
  ProjectListInput,
  ProjectLocationInput,
  ProjectPage,
  ProjectStatusInput,
  ProjectView,
} from '../../shared/contracts.js';
import type { HttpTransport } from '../api/transport.js';

const instant = z.string().datetime({ offset: true });
const personalWorkspace = z.object({
  workspaceId: z.string().uuid(), type: z.literal('PERSONAL'), role: z.literal('OWNER'), createdAt: instant, updatedAt: instant,
}).strict();
const project = z.object({
  projectId: z.string().uuid(), workspaceId: z.string().uuid(), name: z.string(), description: z.string(),
  status: z.enum(['ACTIVE', 'ARCHIVED']), version: z.number().int().nonnegative(), createdAt: instant, updatedAt: instant,
  archivedAt: instant.nullable(),
}).strict();
const projectPage = z.object({ items: z.array(project), nextCursor: z.string().nullable() }).strict();

export interface WorkspaceProjectPort {
  listWorkspaces(accessToken: string): Promise<PersonalWorkspaceView[]>;
  listProjects(accessToken: string, input: ProjectListInput): Promise<ProjectPage>;
  getProject(accessToken: string, input: ProjectLocationInput): Promise<ProjectView>;
  createProject(accessToken: string, input: CreateProjectInput): Promise<ProjectView>;
  editProject(accessToken: string, input: EditProjectInput): Promise<ProjectView>;
  archiveProject(accessToken: string, input: ProjectStatusInput): Promise<ProjectView>;
  restoreProject(accessToken: string, input: ProjectStatusInput): Promise<ProjectView>;
  permanentlyDeleteProject(accessToken: string, input: DeleteProjectInput): Promise<void>;
}

export class WorkspaceProjectClient implements WorkspaceProjectPort {
  constructor(private readonly transport: HttpTransport) {}

  async listWorkspaces(accessToken: string) {
    return z.array(personalWorkspace).parse(await this.transport.request({ method: 'GET', path: '/desktop/v1/workspaces', accessToken }));
  }
  async listProjects(accessToken: string, input: ProjectListInput) {
    const query = new URLSearchParams({ status: input.status, limit: String(input.limit ?? 50) });
    if (input.cursor !== undefined) query.set('cursor', input.cursor);
    return projectPage.parse(await this.transport.request({ method: 'GET', path: `${this.collection(input.workspaceId)}?${query}`, accessToken }));
  }
  async getProject(accessToken: string, input: ProjectLocationInput) {
    return project.parse(await this.transport.request({ method: 'GET', path: this.item(input), accessToken }));
  }
  async createProject(accessToken: string, input: CreateProjectInput) {
    const { workspaceId, ...body } = input;
    return project.parse(await this.transport.request({ method: 'POST', path: this.collection(workspaceId), body, accessToken }));
  }
  async editProject(accessToken: string, input: EditProjectInput) {
    const { workspaceId, projectId, ...body } = input;
    return project.parse(await this.transport.request({ method: 'PATCH', path: this.item({ workspaceId, projectId }), body, accessToken }));
  }
  async archiveProject(accessToken: string, input: ProjectStatusInput) { return this.statusAction(accessToken, input, 'archive'); }
  async restoreProject(accessToken: string, input: ProjectStatusInput) { return this.statusAction(accessToken, input, 'restore'); }
  async permanentlyDeleteProject(accessToken: string, input: DeleteProjectInput) {
    const { workspaceId, projectId, ...body } = input;
    await this.transport.request({ method: 'POST', path: `${this.item({ workspaceId, projectId })}/permanent-deletion`, body, accessToken });
  }
  private async statusAction(accessToken: string, input: ProjectStatusInput, action: 'archive' | 'restore') {
    const { workspaceId, projectId, ...body } = input;
    return project.parse(await this.transport.request({ method: 'POST', path: `${this.item({ workspaceId, projectId })}/${action}`, body, accessToken }));
  }
  private collection(workspaceId: string) { return `/desktop/v1/workspaces/${workspaceId}/projects`; }
  private item(input: ProjectLocationInput) { return `${this.collection(input.workspaceId)}/${input.projectId}`; }
}
