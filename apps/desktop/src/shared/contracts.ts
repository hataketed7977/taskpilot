export interface CurrentUserView { userId: string; displayName: string; email: string }
export interface IssuedSession {
  accessToken: string; accessTokenExpiresAt: string;
  refreshToken: string; refreshTokenExpiresAt: string;
  currentUser: CurrentUserView;
}
export type SessionView =
  | { status: 'signedOut' }
  | { status: 'restoring' }
  | { status: 'temporarilyUnavailable' }
  | { status: 'authenticated'; currentUser: CurrentUserView };

export interface WorkspaceItem { workspaceId: string; name: string; type: 'ORGANIZATION' | 'PERSONAL' }
export interface WorkspaceList { items: WorkspaceItem[]; capabilities: { canCreateWorkspace: boolean; createWorkspaceReasonCode?: string } }
export interface ProjectItem { projectId: string; workspaceId: string; name: string }
export interface ProjectPage { items: ProjectItem[]; nextCursor?: string }

export type DesktopError = {
  code: string;
  category: 'validation' | 'authentication' | 'authorization' | 'conflict' | 'temporary' | 'unknown';
  path?: string;
  retryAfterSeconds?: number;
  recovery?: 'RETRY' | 'SIGN_IN' | 'CHOOSE_WORKSPACE';
};

export type DesktopResult<T> = { ok: true; value: T } | { ok: false; error: DesktopError };

export type AuthFlowKind = 'registration' | 'passwordReset';
export interface AuthFlowView { flowHandle: string; expiresAt: string }

export interface AuthCapabilities {
  signInWithPassword(input: { email: string; password: string }): Promise<SessionView>;
  requestLoginCode(input: { email: string }): Promise<{ challengeId: string; retryAfterSeconds: number }>;
  verifyLoginCode(input: { challengeId: string; email: string; code: string }): Promise<SessionView>;
  requestRegistrationCode(input: { email: string }): Promise<{ challengeId: string; retryAfterSeconds: number }>;
  verifyRegistrationCode(input: { challengeId: string; email: string; code: string }): Promise<AuthFlowView>;
  register(input: { flowHandle: string; email: string; displayName: string; password: string; termsVersion: string }): Promise<SessionView>;
  requestPasswordResetCode(input: { email: string }): Promise<{ challengeId: string; retryAfterSeconds: number }>;
  verifyPasswordResetCode(input: { challengeId: string; email: string; code: string }): Promise<AuthFlowView>;
  resetPassword(input: { flowHandle: string; email: string; newPassword: string }): Promise<void>;
  getSessionView(): Promise<SessionView>;
  subscribeSessionView(listener: (view: SessionView) => void): () => void;
  logout(): Promise<void>;
}
export interface WorkspaceCapabilities {
  listWorkspaces(): Promise<WorkspaceList>;
  createWorkspace(input: { name: string; creationRequestId: string }): Promise<WorkspaceItem>;
  restoreActiveWorkspace(input: { availableWorkspaceIds: string[] }): Promise<{ workspaceId?: string }>;
  selectWorkspace(input: { workspaceId: string }): Promise<void>;
  clearActiveWorkspace(): Promise<void>;
}
export interface ProjectCapabilities {
  listProjects(input: { workspaceId: string; cursor?: string; limit?: number }): Promise<ProjectPage>;
}
export interface TaskPilotDesktopApi { auth: AuthCapabilities; workspaces: WorkspaceCapabilities; projects: ProjectCapabilities }
