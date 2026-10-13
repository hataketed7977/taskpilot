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
export interface TaskPilotDesktopApi { auth: AuthCapabilities }
