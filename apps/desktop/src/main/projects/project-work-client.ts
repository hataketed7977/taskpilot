import { z } from 'zod';
import type {
  BoardLocationInput,
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
  MoveCardInput,
  ProjectLocationInput,
  ReorderColumnsInput,
  WorkItemLocationInput,
  WorkItemView,
} from '../../shared/contracts.js';
import type { HttpTransport } from '../api/transport.js';

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const nonnegative = z.number().int().nonnegative();
const boardSummary = z.object({
  boardId: uuid, projectId: uuid, name: z.string(), description: z.string(), version: nonnegative,
  createdAt: instant, updatedAt: instant,
}).strict();
const card = z.object({
  workItemId: uuid, title: z.string(), description: z.string(), lifecycle: z.literal('OPEN'),
  workItemVersion: nonnegative, placementVersion: nonnegative, position: nonnegative,
}).strict();
const column = z.object({
  columnId: uuid, name: z.string(), position: nonnegative, version: nonnegative,
  createdAt: instant, updatedAt: instant, cards: z.array(card),
}).strict();
const board = boardSummary.extend({ columns: z.array(column) }).strict();
const workItem = z.object({
  workItemId: uuid, projectId: uuid, title: z.string(), description: z.string(), lifecycle: z.literal('OPEN'),
  version: nonnegative, createdAt: instant, updatedAt: instant,
}).strict();
const createWorkItemResult = z.object({ workItem, board }).strict();
const editWorkItemResult = z.object({ workItem, board }).strict();

export interface ProjectWorkPort {
  listBoards(accessToken: string, input: ProjectLocationInput): Promise<BoardSummary[]>;
  getBoard(accessToken: string, input: BoardLocationInput): Promise<BoardView>;
  createBoard(accessToken: string, input: CreateBoardInput): Promise<BoardView>;
  editBoard(accessToken: string, input: EditBoardInput): Promise<BoardView>;
  createColumn(accessToken: string, input: CreateColumnInput): Promise<BoardView>;
  editColumn(accessToken: string, input: EditColumnInput): Promise<BoardView>;
  reorderColumns(accessToken: string, input: ReorderColumnsInput): Promise<BoardView>;
  deleteColumn(accessToken: string, input: DeleteColumnInput): Promise<void>;
  createWorkItem(accessToken: string, input: CreateWorkItemInput): Promise<CreateWorkItemResult>;
  getWorkItem(accessToken: string, input: WorkItemLocationInput): Promise<WorkItemView>;
  editWorkItem(accessToken: string, input: EditWorkItemInput): Promise<EditWorkItemResult>;
  moveCard(accessToken: string, input: MoveCardInput): Promise<BoardView>;
}

export class ProjectWorkClient implements ProjectWorkPort {
  constructor(private readonly transport: HttpTransport) {}

  async listBoards(accessToken: string, input: ProjectLocationInput) {
    return z.array(boardSummary).parse(await this.transport.request({ method: 'GET', path: this.boards(input), accessToken }));
  }
  async getBoard(accessToken: string, input: BoardLocationInput) {
    return board.parse(await this.transport.request({ method: 'GET', path: this.board(input), accessToken }));
  }
  async createBoard(accessToken: string, input: CreateBoardInput) {
    const { workspaceId, projectId, ...body } = input;
    return board.parse(await this.transport.request({ method: 'POST', path: this.boards({ workspaceId, projectId }), body, accessToken }));
  }
  async editBoard(accessToken: string, input: EditBoardInput) {
    const body = { expectedVersion: input.expectedVersion, name: input.name, description: input.description };
    return board.parse(await this.transport.request({ method: 'PATCH', path: this.board(input), body, accessToken }));
  }
  async createColumn(accessToken: string, input: CreateColumnInput) {
    const body = { requestId: input.requestId, expectedBoardVersion: input.expectedBoardVersion, name: input.name };
    return board.parse(await this.transport.request({ method: 'POST', path: `${this.board(input)}/columns`, body, accessToken }));
  }
  async editColumn(accessToken: string, input: EditColumnInput) {
    const body = {
      expectedBoardVersion: input.expectedBoardVersion,
      expectedColumnVersion: input.expectedColumnVersion,
      name: input.name,
    };
    return board.parse(await this.transport.request({ method: 'PATCH', path: `${this.board(input)}/columns/${input.columnId}`, body, accessToken }));
  }
  async reorderColumns(accessToken: string, input: ReorderColumnsInput) {
    const body = { expectedBoardVersion: input.expectedBoardVersion, columnIds: input.columnIds };
    return board.parse(await this.transport.request({ method: 'PUT', path: `${this.board(input)}/column-order`, body, accessToken }));
  }
  async deleteColumn(accessToken: string, input: DeleteColumnInput) {
    const query = new URLSearchParams({
      expectedBoardVersion: String(input.expectedBoardVersion),
      expectedColumnVersion: String(input.expectedColumnVersion),
    });
    await this.transport.request({ method: 'DELETE', path: `${this.board(input)}/columns/${input.columnId}?${query}`, accessToken });
  }
  async createWorkItem(accessToken: string, input: CreateWorkItemInput) {
    const body = {
      columnId: input.columnId,
      requestId: input.requestId,
      expectedBoardVersion: input.expectedBoardVersion,
      title: input.title,
      description: input.description,
    };
    return createWorkItemResult.parse(await this.transport.request({ method: 'POST', path: `${this.board(input)}/work-items`, body, accessToken }));
  }
  async getWorkItem(accessToken: string, input: WorkItemLocationInput) {
    return workItem.parse(await this.transport.request({ method: 'GET', path: this.workItem(input), accessToken }));
  }
  async editWorkItem(accessToken: string, input: EditWorkItemInput) {
    const body = {
      boardId: input.boardId,
      currentColumnId: input.currentColumnId,
      targetColumnId: input.targetColumnId,
      ...(input.expectedBoardVersion === undefined ? {} : { expectedBoardVersion: input.expectedBoardVersion }),
      ...(input.expectedPlacementVersion === undefined ? {} : { expectedPlacementVersion: input.expectedPlacementVersion }),
      expectedVersion: input.expectedVersion,
      title: input.title,
      description: input.description,
    };
    return editWorkItemResult.parse(await this.transport.request({ method: 'PATCH', path: this.workItem(input), body, accessToken }));
  }
  async moveCard(accessToken: string, input: MoveCardInput) {
    const body = {
      expectedBoardVersion: input.expectedBoardVersion,
      expectedPlacementVersion: input.expectedPlacementVersion,
      targetColumnId: input.targetColumnId,
      beforeWorkItemId: input.beforeWorkItemId,
    };
    return board.parse(await this.transport.request({ method: 'POST', path: `${this.board(input)}/placements/${input.workItemId}/move`, body, accessToken }));
  }

  private projects(input: ProjectLocationInput) { return `/desktop/v1/workspaces/${input.workspaceId}/projects/${input.projectId}`; }
  private boards(input: ProjectLocationInput) { return `${this.projects(input)}/boards`; }
  private board(input: BoardLocationInput) { return `${this.boards(input)}/${input.boardId}`; }
  private workItem(input: WorkItemLocationInput) { return `${this.projects(input)}/work-items/${input.workItemId}`; }
}
