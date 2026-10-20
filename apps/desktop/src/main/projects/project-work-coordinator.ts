import type {
  BoardHomeView,
  BoardLocationInput,
  BoardProjectInput,
  BoardResponseKey,
  BoardSummary,
  BoardView,
  CreateBoardInput,
  CreateColumnInput,
  CreateWorkItemInput,
  CreateWorkItemResult,
  DeleteColumnInput,
  EditBoardInput,
  EditColumnInput,
  EditWorkItemInput,
  EditWorkItemResult,
  KeyedResponse,
  MoveCardInput,
  ReorderColumnsInput,
  WorkItemLocationInput,
  WorkItemView,
} from '../../shared/contracts.js';
import type { Environment } from '../api/transport.js';
import type { SessionContext, SessionCoordinator } from '../session/session-coordinator.js';
import type { ProjectWorkPort } from './project-work-client.js';
import type { RecentBoardStore } from './recent-board-store.js';

type BoardKeyed<T> = KeyedResponse<T, BoardResponseKey>;

export class ProjectWorkCoordinator {
  private readonly boardGenerations = new Map<string, number>();
  private selectionIntent = 0;
  private preferenceWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly environment: Environment,
    private readonly session: SessionCoordinator,
    private readonly client: ProjectWorkPort,
    private readonly preferences: RecentBoardStore,
  ) {}

  async resolveHome(input: BoardProjectInput): Promise<BoardKeyed<BoardHomeView>> {
    const intent = ++this.selectionIntent;
    const context = this.session.context();
    const boards = await this.session.protected(token => this.client.listBoards(token, input));
    this.session.assertCurrent(context);
    const recent = await this.preferences.load(this.environment, context.user.userId, input.workspaceId, input.projectId).catch(() => undefined);
    this.session.assertCurrent(context);
    const selected = boards.find(item => item.boardId === recent) ?? boards[0];
    if (!selected) return { key: this.key(context, input), value: { boards } };
    const generation = this.generation(input, selected.boardId);
    const currentBoard = await this.session.protected(token => this.client.getBoard(token, { ...input, boardId: selected.boardId }));
    this.session.assertCurrent(context);
    await this.remember(context, input, selected.boardId, intent);
    return {
      key: this.key(context, input, selected.boardId, generation),
      value: { boards, currentBoard },
    };
  }

  async list(input: BoardProjectInput): Promise<BoardKeyed<BoardSummary[]>> {
    const context = this.session.context();
    const value = await this.session.protected(token => this.client.listBoards(token, input));
    return { key: this.key(context, input), value };
  }

  async open(input: BoardLocationInput): Promise<BoardKeyed<BoardView>> {
    const intent = ++this.selectionIntent;
    const context = this.session.context();
    const generation = this.generation(input, input.boardId);
    const value = await this.session.protected(token => this.client.getBoard(token, input));
    await this.remember(context, input, input.boardId, intent);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  async create(input: CreateBoardInput): Promise<BoardKeyed<BoardView>> {
    const intent = ++this.selectionIntent;
    const context = this.session.context();
    const value = await this.session.protected(token => this.client.createBoard(token, input));
    const generation = this.invalidate(input, value.boardId);
    await this.remember(context, input, value.boardId, intent);
    return { key: this.key(context, input, value.boardId, generation), value };
  }

  edit(input: EditBoardInput) { return this.mutateBoard(input, token => this.client.editBoard(token, input)); }
  createColumn(input: CreateColumnInput) { return this.mutateBoard(input, token => this.client.createColumn(token, input)); }
  editColumn(input: EditColumnInput) { return this.mutateBoard(input, token => this.client.editColumn(token, input)); }
  reorderColumns(input: ReorderColumnsInput) { return this.mutateBoard(input, token => this.client.reorderColumns(token, input)); }
  moveCard(input: MoveCardInput) { return this.mutateBoard(input, token => this.client.moveCard(token, input)); }

  async deleteColumn(input: DeleteColumnInput): Promise<BoardKeyed<void>> {
    const context = this.session.context();
    const value = await this.session.protected(token => this.client.deleteColumn(token, input));
    const generation = this.invalidate(input, input.boardId);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<BoardKeyed<CreateWorkItemResult>> {
    const context = this.session.context();
    const value = await this.session.protected(token => this.client.createWorkItem(token, input));
    const generation = this.invalidate(input, input.boardId);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  async openWorkItem(input: WorkItemLocationInput): Promise<BoardKeyed<WorkItemView>> {
    const context = this.session.context();
    const value = await this.session.protected(token => this.client.getWorkItem(token, input));
    return { key: this.key(context, input), value };
  }

  async editWorkItem(input: EditWorkItemInput): Promise<BoardKeyed<EditWorkItemResult>> {
    const context = this.session.context();
    const value = await this.session.protected(token => this.client.editWorkItem(token, input));
    const generation = this.invalidate(input, input.boardId);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  private async mutateBoard(input: BoardLocationInput, operation: (accessToken: string) => Promise<BoardView>): Promise<BoardKeyed<BoardView>> {
    const context = this.session.context();
    const value = await this.session.protected(operation);
    const generation = this.invalidate(input, input.boardId);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  private generation(input: BoardProjectInput, boardId: string): number {
    return this.boardGenerations.get(this.scope(input, boardId)) ?? 0;
  }
  private invalidate(input: BoardProjectInput, boardId: string): number {
    const scope = this.scope(input, boardId);
    const generation = (this.boardGenerations.get(scope) ?? 0) + 1;
    this.boardGenerations.set(scope, generation);
    return generation;
  }
  private scope(input: BoardProjectInput, boardId: string) { return `${input.workspaceId}:${input.projectId}:${boardId}`; }
  private key(context: SessionContext, input: BoardProjectInput, boardId?: string, boardGeneration?: number): BoardResponseKey {
    return {
      sessionGeneration: context.generation,
      userId: context.user.userId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      ...(boardId ? { boardId } : {}),
      ...(boardGeneration !== undefined ? { boardGeneration } : {}),
    };
  }
  private async remember(context: SessionContext, input: BoardProjectInput, boardId: string, intent: number): Promise<void> {
    this.session.assertCurrent(context);
    const write = this.preferenceWrite.then(async () => {
      if (intent !== this.selectionIntent) return;
      this.session.assertCurrent(context);
      await this.preferences.save(this.environment, context.user.userId, input.workspaceId, input.projectId, boardId).catch(() => undefined);
      this.session.assertCurrent(context);
    });
    this.preferenceWrite = write.catch(() => undefined);
    await write;
  }
}
