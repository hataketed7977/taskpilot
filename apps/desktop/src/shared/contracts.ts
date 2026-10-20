export interface CurrentUserView { userId: string; displayName: string; avatarUrl?: string }
export interface IssuedSession {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  currentUser: CurrentUserView;
}
export type SessionView =
  | { status: 'signedOut' }
  | { status: 'restoring' }
  | { status: 'temporarilyUnavailable' }
  | { status: 'authenticated'; currentUser: CurrentUserView };

export interface GitHubCapabilityView { enabled: boolean }
export type FederatedAuthFlowView =
  | { status: 'waiting'; flowId: string; expiresAt: string }
  | { status: 'completionRequired'; flowId: string; expiresAt: string }
  | { status: 'registrationRequired'; flowId: string; suggestedDisplayName: string; suggestedAvatarUrl?: string; legalBundleVersion: string; termsVersion: string; privacyVersion: string; legalLocales: string[] }
  | { status: 'denied' | 'cancelled' | 'expired' | 'failed' | 'resultUnavailable'; flowId: string }
  | { status: 'authenticated'; currentUser: CurrentUserView };

export type DesktopError = {
  code: string;
  category: 'validation' | 'authentication' | 'authorization' | 'conflict' | 'temporary' | 'unknown';
  path?: string;
  retryAfterSeconds?: number;
  recovery?: 'RETRY' | 'SIGN_IN';
};
export type DesktopResult<T> = { ok: true; value: T } | { ok: false; error: DesktopError };

export interface PersonalWorkspaceView {
  workspaceId: string;
  type: 'PERSONAL';
  role: 'OWNER';
  createdAt: string;
  updatedAt: string;
}
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';
export interface ProjectView {
  projectId: string;
  workspaceId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
export interface ProjectPage { items: ProjectView[]; nextCursor: string | null }
export interface ProjectResponseKey {
  sessionGeneration: number;
  userId: string;
  workspaceId?: string;
  projectId?: string;
  status?: ProjectStatus;
}
export interface KeyedResponse<T, K extends ProjectResponseKey = ProjectResponseKey> { key: K; value: T }
export interface ProjectHomeView {
  workspace: PersonalWorkspaceView;
  projects: ProjectView[];
  currentProject?: ProjectView;
}
export interface ProjectLocationInput { workspaceId: string; projectId: string }
export interface ProjectListInput { workspaceId: string; status: ProjectStatus; limit?: number; cursor?: string }
export interface CreateProjectInput { workspaceId: string; requestId: string; name: string; description?: string; locale: 'zh-CN' | 'en' }
export interface EditProjectInput extends ProjectLocationInput { expectedVersion: number; name: string; description?: string }
export interface ProjectStatusInput extends ProjectLocationInput { expectedVersion: number }
export interface DeleteProjectInput extends ProjectStatusInput { confirmationName: string }

export interface BoardSummary {
  boardId: string;
  projectId: string;
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface CardView {
  workItemId: string;
  title: string;
  description: string;
  lifecycle: 'OPEN';
  workItemVersion: number;
  placementVersion: number;
  position: number;
}
export interface BoardColumnView {
  columnId: string;
  name: string;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  cards: CardView[];
}
export interface BoardView extends BoardSummary { columns: BoardColumnView[] }
export interface WorkItemView {
  workItemId: string;
  projectId: string;
  title: string;
  description: string;
  lifecycle: 'OPEN';
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface CreateWorkItemResult { workItem: WorkItemView; board: BoardView }
export interface EditWorkItemResult { workItem: WorkItemView; board: BoardView }
export interface BoardHomeView { boards: BoardSummary[]; currentBoard?: BoardView }
export interface BoardResponseKey extends ProjectResponseKey {
  workspaceId: string;
  projectId: string;
  boardId?: string;
  boardGeneration?: number;
}
export interface BoardLocationInput extends ProjectLocationInput { boardId: string }
export type BoardProjectInput = ProjectLocationInput;
export interface CreateBoardInput extends ProjectLocationInput { requestId: string; name: string; description?: string; locale: 'zh-CN' | 'en' }
export interface EditBoardInput extends BoardLocationInput { expectedVersion: number; name: string; description?: string }
export interface CreateColumnInput extends BoardLocationInput { requestId: string; expectedBoardVersion: number; name: string }
export interface EditColumnInput extends BoardLocationInput { columnId: string; expectedBoardVersion: number; expectedColumnVersion: number; name: string }
export interface ReorderColumnsInput extends BoardLocationInput { expectedBoardVersion: number; columnIds: string[] }
export interface DeleteColumnInput extends BoardLocationInput { columnId: string; expectedBoardVersion: number; expectedColumnVersion: number }
export interface CreateWorkItemInput extends BoardLocationInput { columnId: string; requestId: string; expectedBoardVersion: number; title: string; description?: string }
export interface WorkItemLocationInput extends ProjectLocationInput { workItemId: string }
export interface EditWorkItemInput extends WorkItemLocationInput {
  boardId: string;
  currentColumnId: string;
  targetColumnId: string;
  expectedBoardVersion?: number;
  expectedPlacementVersion?: number;
  expectedVersion: number;
  title: string;
  description?: string;
}
export interface MoveCardInput extends BoardLocationInput { workItemId: string; expectedBoardVersion: number; expectedPlacementVersion: number; targetColumnId: string; beforeWorkItemId?: string }

export interface AuthCapabilities {
  getCapabilities(): Promise<{ github: GitHubCapabilityView }>;
  startGitHubSignIn(): Promise<FederatedAuthFlowView>;
  continueGitHubSignIn(input: { flowId: string }): Promise<FederatedAuthFlowView>;
  completeGitHubRegistration(input: { flowId: string; displayName: string; useSuggestedAvatar: boolean; legalBundleVersion: string; termsVersion: string; privacyVersion: string; locale: string }): Promise<FederatedAuthFlowView>;
  cancelGitHubSignIn(input: { flowId: string }): Promise<void>;
  getSessionView(): Promise<SessionView>;
  subscribeSessionView(listener: (view: SessionView) => void): () => void;
  logout(): Promise<void>;
}
export interface WorkspaceCapabilities {
  list(): Promise<KeyedResponse<PersonalWorkspaceView[]>>;
}
export interface ProjectCapabilities {
  resolveHome(): Promise<KeyedResponse<ProjectHomeView>>;
  list(input: ProjectListInput): Promise<KeyedResponse<ProjectPage>>;
  open(input: ProjectLocationInput): Promise<KeyedResponse<ProjectView>>;
  create(input: CreateProjectInput): Promise<KeyedResponse<ProjectView>>;
  edit(input: EditProjectInput): Promise<KeyedResponse<ProjectView>>;
  archive(input: ProjectStatusInput): Promise<KeyedResponse<ProjectView>>;
  restore(input: ProjectStatusInput): Promise<KeyedResponse<ProjectView>>;
  permanentlyDelete(input: DeleteProjectInput): Promise<KeyedResponse<void>>;
}
export interface BoardCapabilities {
  resolveHome(input: BoardProjectInput): Promise<KeyedResponse<BoardHomeView, BoardResponseKey>>;
  list(input: BoardProjectInput): Promise<KeyedResponse<BoardSummary[], BoardResponseKey>>;
  open(input: BoardLocationInput): Promise<KeyedResponse<BoardView, BoardResponseKey>>;
  create(input: CreateBoardInput): Promise<KeyedResponse<BoardView, BoardResponseKey>>;
  edit(input: EditBoardInput): Promise<KeyedResponse<BoardView, BoardResponseKey>>;
  createColumn(input: CreateColumnInput): Promise<KeyedResponse<BoardView, BoardResponseKey>>;
  editColumn(input: EditColumnInput): Promise<KeyedResponse<BoardView, BoardResponseKey>>;
  reorderColumns(input: ReorderColumnsInput): Promise<KeyedResponse<BoardView, BoardResponseKey>>;
  deleteColumn(input: DeleteColumnInput): Promise<KeyedResponse<void, BoardResponseKey>>;
  createWorkItem(input: CreateWorkItemInput): Promise<KeyedResponse<CreateWorkItemResult, BoardResponseKey>>;
  openWorkItem(input: WorkItemLocationInput): Promise<KeyedResponse<WorkItemView, BoardResponseKey>>;
  editWorkItem(input: EditWorkItemInput): Promise<KeyedResponse<EditWorkItemResult, BoardResponseKey>>;
  moveCard(input: MoveCardInput): Promise<KeyedResponse<BoardView, BoardResponseKey>>;
}
export interface TaskPilotDesktopApi {
  auth: AuthCapabilities;
  workspaces: WorkspaceCapabilities;
  projects: ProjectCapabilities;
  boards: BoardCapabilities;
}
