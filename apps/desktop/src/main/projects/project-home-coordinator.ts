import type {
  CreateProjectInput,
  DeleteProjectInput,
  EditProjectInput,
  KeyedResponse,
  PersonalWorkspaceView,
  ProjectHomeView,
  ProjectListInput,
  ProjectLocationInput,
  ProjectPage,
  ProjectResponseKey,
  ProjectStatusInput,
  ProjectView,
} from '../../shared/contracts.js';
import { TransportError, type Environment } from '../api/transport.js';
import type { SessionContext, SessionCoordinator } from '../session/session-coordinator.js';
import type { WorkspaceProjectPort } from './project-client.js';
import type { RecentProjectStore } from './recent-project-store.js';

export interface ProjectBootstrap { workspaceId: string; projectId: string }

export class ProjectHomeCoordinator {
  private bootstrap?: { context: SessionContext; value: ProjectBootstrap };
  private selectionIntent = 0;
  private preferenceWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly environment: Environment,
    private readonly session: SessionCoordinator,
    private readonly client: WorkspaceProjectPort,
    private readonly preferences: RecentProjectStore,
  ) {}

  acceptBootstrap(value: ProjectBootstrap): void {
    this.bootstrap = { context: this.session.context(), value };
  }

  async listWorkspaces(): Promise<KeyedResponse<PersonalWorkspaceView[]>> {
    const context = this.session.context();
    const value = await this.session.protected(token => this.client.listWorkspaces(token));
    return { key: this.key(context), value };
  }

  async resolveHome(): Promise<KeyedResponse<ProjectHomeView>> {
    const intent = ++this.selectionIntent;
    const context = this.session.context();
    const workspaces = await this.session.protected(token => this.client.listWorkspaces(token));
    this.session.assertCurrent(context);
    const workspace = requirePersonalWorkspace(workspaces);
    const currentProject = await this.resolveCurrentProject(context, workspace.workspaceId);
    const projects = await this.listAllProjects(context, workspace.workspaceId, 'ACTIVE');
    const selected = currentProject ?? projects[0];
    if (selected) await this.rememberSelection(context, selected.projectId, intent);
    return {
      key: this.key(context, { workspaceId: workspace.workspaceId, projectId: selected?.projectId, status: 'ACTIVE' }),
      value: { workspace, projects, ...(selected ? { currentProject: selected } : {}) },
    };
  }

  async list(input: ProjectListInput): Promise<KeyedResponse<ProjectPage>> {
    return this.execute(input, token => this.client.listProjects(token, input), { status: input.status });
  }
  async open(input: ProjectLocationInput): Promise<KeyedResponse<ProjectView>> {
    const intent = ++this.selectionIntent;
    const result = await this.execute(input, token => this.client.getProject(token, input));
    if (result.value.status === 'ACTIVE') await this.rememberSelectionContext(result.key, result.value.projectId, intent);
    return result;
  }
  async create(input: CreateProjectInput): Promise<KeyedResponse<ProjectView>> {
    const intent = ++this.selectionIntent;
    const result = await this.execute(input, token => this.client.createProject(token, input));
    const created = { ...result, key: { ...result.key, projectId: result.value.projectId } };
    await this.rememberSelectionContext(created.key, created.value.projectId, intent);
    return created;
  }
  async edit(input: EditProjectInput): Promise<KeyedResponse<ProjectView>> {
    return this.execute(input, token => this.client.editProject(token, input));
  }
  async archive(input: ProjectStatusInput): Promise<KeyedResponse<ProjectView>> {
    this.selectionIntent += 1;
    const result = await this.execute(input, token => this.client.archiveProject(token, input));
    await this.clearIfRemembered(result.key, input.projectId);
    return result;
  }
  async restore(input: ProjectStatusInput): Promise<KeyedResponse<ProjectView>> {
    return this.execute(input, token => this.client.restoreProject(token, input));
  }
  async permanentlyDelete(input: DeleteProjectInput): Promise<KeyedResponse<void>> {
    this.selectionIntent += 1;
    const result = await this.execute(input, token => this.client.permanentlyDeleteProject(token, input));
    await this.clearIfRemembered(result.key, input.projectId);
    return result;
  }

  private async listAllProjects(
    context: SessionContext,
    workspaceId: string,
    status: ProjectListInput['status'],
  ): Promise<ProjectView[]> {
    const items: ProjectView[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.session.protected(token => this.client.listProjects(token, {
        workspaceId, status, limit: 50, ...(cursor ? { cursor } : {}),
      }));
      this.session.assertCurrent(context);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (cursor && seenCursors.has(cursor)) throw new Error('Project pagination cursor repeated');
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return items;
  }

  private async resolveCurrentProject(context: SessionContext, workspaceId: string): Promise<ProjectView | undefined> {
    const bootstrap = this.bootstrap;
    this.bootstrap = undefined;
    if (bootstrap && sameContext(bootstrap.context, context) && bootstrap.value.workspaceId === workspaceId) {
      const value = await this.tryActive(context, bootstrap.value);
      if (value) return value;
    }
    const recent = await this.preferences.load(this.environment, context.user.userId).catch(() => undefined);
    if (!recent) return undefined;
    const value = await this.tryActive(context, { workspaceId, projectId: recent });
    if (!value) await this.preferences.clear(this.environment, context.user.userId).catch(() => undefined);
    return value;
  }

  private async tryActive(context: SessionContext, input: ProjectLocationInput): Promise<ProjectView | undefined> {
    try {
      const value = await this.session.protected(token => this.client.getProject(token, input));
      this.session.assertCurrent(context);
      return value.status === 'ACTIVE' && value.workspaceId === input.workspaceId ? value : undefined;
    } catch (error) {
      if (error instanceof TransportError && error.status === 404) return undefined;
      throw error;
    }
  }

  private async execute<T>(
    input: { workspaceId: string; projectId?: string },
    operation: (token: string) => Promise<T>,
    extra?: { status?: ProjectListInput['status'] },
  ): Promise<KeyedResponse<T>> {
    const context = this.session.context();
    const value = await this.session.protected(operation);
    return { key: this.key(context, { ...input, ...extra }), value };
  }

  private key(context: SessionContext, input: { workspaceId?: string; projectId?: string; status?: ProjectListInput['status'] } = {}): ProjectResponseKey {
    return { sessionGeneration: context.generation, userId: context.user.userId, ...input };
  }
  private async rememberSelection(context: SessionContext, projectId: string, intent: number) {
    this.session.assertCurrent(context);
    const write = this.preferenceWrite.then(async () => {
      if (intent !== this.selectionIntent) return;
      this.session.assertCurrent(context);
      await this.preferences.save(this.environment, context.user.userId, projectId).catch(() => undefined);
      this.session.assertCurrent(context);
    });
    this.preferenceWrite = write.catch(() => undefined);
    await write;
  }
  private async rememberSelectionContext(key: ProjectResponseKey, projectId: string, intent: number) {
    const context = this.session.context();
    if (key.sessionGeneration === context.generation && key.userId === context.user.userId) {
      await this.rememberSelection(context, projectId, intent);
    }
  }
  private async clearIfRemembered(key: ProjectResponseKey, projectId: string) {
    const context = this.session.context();
    if (key.sessionGeneration !== context.generation || key.userId !== context.user.userId) return;
    const current = await this.preferences.load(this.environment, context.user.userId).catch(() => undefined);
    if (current === projectId) await this.preferences.clear(this.environment, context.user.userId).catch(() => undefined);
  }
}

function requirePersonalWorkspace(workspaces: PersonalWorkspaceView[]): PersonalWorkspaceView {
  if (workspaces.length !== 1 || workspaces[0]?.type !== 'PERSONAL') {
    throw Object.assign(new Error('Personal Workspace unavailable'), { code: 'PERSONAL_WORKSPACE_UNAVAILABLE', category: 'temporary', recovery: 'RETRY' });
  }
  return workspaces[0];
}
function sameContext(left: SessionContext, right: SessionContext) {
  return left.generation === right.generation && left.user.userId === right.user.userId;
}
