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
export interface KeyedResponse<T> { key: ProjectResponseKey; value: T }
export interface ProjectHomeView {
  workspace: PersonalWorkspaceView;
  projects: ProjectView[];
  currentProject?: ProjectView;
}
export interface ProjectLocationInput { workspaceId: string; projectId: string }
export interface ProjectListInput { workspaceId: string; status: ProjectStatus; limit?: number; cursor?: string }
export interface CreateProjectInput { workspaceId: string; requestId: string; name: string; description?: string }
export interface EditProjectInput extends ProjectLocationInput { expectedVersion: number; name: string; description?: string }
export interface ProjectStatusInput extends ProjectLocationInput { expectedVersion: number }
export interface DeleteProjectInput extends ProjectStatusInput { confirmationName: string }

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
export interface TaskPilotDesktopApi {
  auth: AuthCapabilities;
  workspaces: WorkspaceCapabilities;
  projects: ProjectCapabilities;
}
