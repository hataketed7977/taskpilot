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
  DeleteBoardInput,
  DeleteBoardOutcome,
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
import { OutcomeUnknownError } from '../api/transport.js';
import type { Environment } from '../api/transport.js';
import type { SessionContext, SessionCoordinator } from '../session/session-coordinator.js';
import type { ProjectWorkPort } from './project-work-client.js';
import type { RecentBoardStore } from './recent-board-store.js';

type BoardKeyed<T> = KeyedResponse<T, BoardResponseKey>;
interface OperationToken { scope: string; eligibility: number }

export class ProjectWorkCoordinator {
  private readonly boardGenerations = new Map<string, number>();
  private readonly boardEligibility = new Map<string, number>();
  private readonly tombstones = new Set<string>();
  private readonly reconciliationIsolation = new Map<string, DeleteBoardInput>();
  private selectionIntent = 0;
  private preferenceWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly environment: Environment,
    private readonly session: SessionCoordinator,
    private readonly client: ProjectWorkPort,
    private readonly preferences: RecentBoardStore,
  ) {}

  async resolveHome(input: BoardProjectInput): Promise<BoardKeyed<BoardHomeView>> {
    const context = this.session.context();
    const pending = this.pendingReconciliation(context, input);
    if (pending) return this.reconcileUnknownDeletion(context, pending, false) as Promise<BoardKeyed<BoardHomeView>>;

    const intent = ++this.selectionIntent;
    const boards = await this.session.protected(token => this.client.listBoards(token, input));
    this.session.assertCurrent(context);
    const recent = await this.preferences.load(this.environment, context.user.userId, input.workspaceId, input.projectId).catch(() => undefined);
    this.session.assertCurrent(context);
    const selected = boards.find(item => item.boardId === recent) ?? boards[0];
    return this.homeFromBoards(context, input, boards, selected?.boardId, intent);
  }

  async list(input: BoardProjectInput): Promise<BoardKeyed<BoardSummary[]>> {
    const context = this.session.context();
    const value = await this.session.protected(token => this.client.listBoards(token, input));
    return { key: this.key(context, input), value };
  }

  async open(input: BoardLocationInput): Promise<BoardKeyed<BoardView>> {
    const intent = ++this.selectionIntent;
    const context = this.session.context();
    const token = this.start(context, input);
    const generation = this.generation(context, input, input.boardId);
    const value = await this.session.protected(accessToken => this.client.getBoard(accessToken, input));
    this.assertEligible(context, token);
    await this.remember(context, input, input.boardId, intent);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  async create(input: CreateBoardInput): Promise<BoardKeyed<BoardView>> {
    const intent = ++this.selectionIntent;
    const context = this.session.context();
    const value = await this.session.protected(token => this.client.createBoard(token, input));
    const generation = this.invalidate(context, input, value.boardId);
    await this.remember(context, input, value.boardId, intent);
    return { key: this.key(context, input, value.boardId, generation), value };
  }

  edit(input: EditBoardInput) { return this.mutateBoard(input, token => this.client.editBoard(token, input)); }
  createColumn(input: CreateColumnInput) { return this.mutateBoard(input, token => this.client.createColumn(token, input)); }
  editColumn(input: EditColumnInput) { return this.mutateBoard(input, token => this.client.editColumn(token, input)); }
  reorderColumns(input: ReorderColumnsInput) { return this.mutateBoard(input, token => this.client.reorderColumns(token, input)); }
  moveCard(input: MoveCardInput) { return this.mutateBoard(input, token => this.client.moveCard(token, input)); }

  async permanentlyDeleteBoard(input: DeleteBoardInput): Promise<BoardKeyed<DeleteBoardOutcome>> {
    const context = this.session.context();
    this.assertAvailable(context, input);
    try {
      await this.session.protected(token => this.client.permanentlyDeleteBoard(token, input));
    } catch (error) {
      if (!(error instanceof OutcomeUnknownError)) throw error;
      this.isolate(context, input);
      return this.reconcileUnknownDeletion(context, input, true) as Promise<BoardKeyed<DeleteBoardOutcome>>;
    }

    const intent = this.tombstone(context, input);
    await this.forget(context, input);
    try {
      const boards = await this.session.protected(token => this.client.listBoards(token, input));
      const home = await this.homeFromBoards(context, input, boards, boards[0]?.boardId, intent);
      return { key: home.key, value: { outcome: 'deleted', home: home.value } };
    } catch (error) {
      throw desktopFailure('BOARD_DELETE_COMMITTED_REFRESH_FAILED', 'temporary', error);
    }
  }

  async deleteColumn(input: DeleteColumnInput): Promise<BoardKeyed<void>> {
    const context = this.session.context();
    const token = this.start(context, input);
    const value = await this.session.protected(accessToken => this.client.deleteColumn(accessToken, input));
    this.assertEligible(context, token);
    const generation = this.invalidate(context, input, input.boardId);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<BoardKeyed<CreateWorkItemResult>> {
    const context = this.session.context();
    const token = this.start(context, input);
    const value = await this.session.protected(accessToken => this.client.createWorkItem(accessToken, input));
    this.assertEligible(context, token);
    const generation = this.invalidate(context, input, input.boardId);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  async openWorkItem(input: WorkItemLocationInput): Promise<BoardKeyed<WorkItemView>> {
    const context = this.session.context();
    const token = this.start(context, input);
    const generation = this.generation(context, input, input.boardId);
    const value = await this.session.protected(accessToken => this.client.getWorkItem(accessToken, input));
    this.assertEligible(context, token);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  async editWorkItem(input: EditWorkItemInput): Promise<BoardKeyed<EditWorkItemResult>> {
    const context = this.session.context();
    const token = this.start(context, input);
    const value = await this.session.protected(accessToken => this.client.editWorkItem(accessToken, input));
    this.assertEligible(context, token);
    const generation = this.invalidate(context, input, input.boardId);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  private async mutateBoard(input: BoardLocationInput, operation: (accessToken: string) => Promise<BoardView>): Promise<BoardKeyed<BoardView>> {
    const context = this.session.context();
    const token = this.start(context, input);
    const value = await this.session.protected(operation);
    this.assertEligible(context, token);
    const generation = this.invalidate(context, input, input.boardId);
    return { key: this.key(context, input, input.boardId, generation), value };
  }

  private async reconcileUnknownDeletion(
    context: SessionContext,
    input: DeleteBoardInput,
    withOutcome: boolean,
  ): Promise<BoardKeyed<BoardHomeView | DeleteBoardOutcome>> {
    let boards: BoardSummary[];
    try {
      boards = await this.session.protected(token => this.client.listBoards(token, input));
      this.session.assertCurrent(context);
    } catch (error) {
      throw desktopFailure('BOARD_DELETE_RESULT_UNKNOWN', 'unknown', error);
    }

    const stillExists = boards.some(board => board.boardId === input.boardId);
    if (!stillExists) {
      const intent = this.tombstone(context, input);
      await this.forget(context, input);
      const home = await this.homeFromBoards(context, input, boards, boards[0]?.boardId, intent);
      return withOutcome ? { key: home.key, value: { outcome: 'deleted', home: home.value } } : home;
    }

    this.releaseIsolation(context, input);
    const intent = ++this.selectionIntent;
    const generation = this.invalidate(context, input, input.boardId);
    const location = { workspaceId: input.workspaceId, projectId: input.projectId, boardId: input.boardId };
    const currentBoard = await this.session.protected(token => this.client.getBoard(token, location));
    this.session.assertCurrent(context);
    await this.remember(context, input, input.boardId, intent);
    const home = { key: this.key(context, input, input.boardId, generation), value: { boards, currentBoard } };
    return withOutcome ? { key: home.key, value: { outcome: 'notDeleted', home: home.value } } : home;
  }

  private async homeFromBoards(
    context: SessionContext,
    input: BoardProjectInput,
    boards: BoardSummary[],
    selectedBoardId: string | undefined,
    intent: number,
  ): Promise<BoardKeyed<BoardHomeView>> {
    if (!selectedBoardId) return { key: this.key(context, input), value: { boards } };
    const location = { ...input, boardId: selectedBoardId };
    const token = this.start(context, location);
    const generation = this.generation(context, input, selectedBoardId);
    const currentBoard = await this.session.protected(accessToken => this.client.getBoard(accessToken, location));
    this.assertEligible(context, token);
    await this.remember(context, input, selectedBoardId, intent);
    return { key: this.key(context, input, selectedBoardId, generation), value: { boards, currentBoard } };
  }

  private start(context: SessionContext, input: BoardLocationInput): OperationToken {
    this.assertAvailable(context, input);
    const scope = this.scope(context, input, input.boardId);
    return { scope, eligibility: this.boardEligibility.get(scope) ?? 0 };
  }

  private assertEligible(context: SessionContext, token: OperationToken): void {
    this.session.assertCurrent(context);
    if (this.tombstones.has(token.scope) || this.reconciliationIsolation.has(token.scope)
      || (this.boardEligibility.get(token.scope) ?? 0) !== token.eligibility) {
      throw desktopFailure('BOARD_RESPONSE_SUPERSEDED', 'conflict');
    }
  }

  private assertAvailable(context: SessionContext, input: BoardLocationInput): void {
    const scope = this.scope(context, input, input.boardId);
    if (this.reconciliationIsolation.has(scope)) throw desktopFailure('BOARD_DELETE_RESULT_UNKNOWN', 'unknown');
    if (this.tombstones.has(scope)) throw desktopFailure('BOARD_RESPONSE_SUPERSEDED', 'conflict');
  }

  private isolate(context: SessionContext, input: DeleteBoardInput): void {
    const scope = this.scope(context, input, input.boardId);
    this.reconciliationIsolation.set(scope, input);
    this.supersede(scope);
    ++this.selectionIntent;
  }

  private releaseIsolation(context: SessionContext, input: BoardLocationInput): void {
    this.reconciliationIsolation.delete(this.scope(context, input, input.boardId));
  }

  private tombstone(context: SessionContext, input: BoardLocationInput): number {
    const scope = this.scope(context, input, input.boardId);
    this.reconciliationIsolation.delete(scope);
    this.tombstones.add(scope);
    this.supersede(scope);
    this.invalidate(context, input, input.boardId);
    return ++this.selectionIntent;
  }

  private supersede(scope: string): void {
    this.boardEligibility.set(scope, (this.boardEligibility.get(scope) ?? 0) + 1);
  }

  private pendingReconciliation(context: SessionContext, input: BoardProjectInput): DeleteBoardInput | undefined {
    const prefix = this.projectScope(context, input);
    for (const [scope, deletion] of this.reconciliationIsolation) if (scope.startsWith(`${prefix}:`)) return deletion;
    return undefined;
  }

  private generation(context: SessionContext, input: BoardProjectInput, boardId: string): number {
    return this.boardGenerations.get(this.scope(context, input, boardId)) ?? 0;
  }

  private invalidate(context: SessionContext, input: BoardProjectInput, boardId: string): number {
    const scope = this.scope(context, input, boardId);
    const generation = (this.boardGenerations.get(scope) ?? 0) + 1;
    this.boardGenerations.set(scope, generation);
    return generation;
  }

  private projectScope(context: SessionContext, input: BoardProjectInput): string {
    return `${this.environment}:${context.user.userId}:${input.workspaceId}:${input.projectId}`;
  }

  private scope(context: SessionContext, input: BoardProjectInput, boardId: string): string {
    return `${this.projectScope(context, input)}:${boardId}`;
  }

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

  private async forget(context: SessionContext, input: BoardProjectInput): Promise<void> {
    this.session.assertCurrent(context);
    const write = this.preferenceWrite.then(async () => {
      this.session.assertCurrent(context);
      await this.preferences.clear(this.environment, context.user.userId, input.workspaceId, input.projectId);
      this.session.assertCurrent(context);
    });
    this.preferenceWrite = write.catch(() => undefined);
    await write.catch(() => undefined);
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

function desktopFailure(code: string, category: 'conflict' | 'temporary' | 'unknown', cause?: unknown): Error {
  return Object.assign(new Error(code, cause === undefined ? undefined : { cause }), {
    code,
    category,
    recovery: 'RETRY' as const,
  });
}
