import type { IssuedSession } from '../../shared/contracts.js';
import type { HttpTransport } from '../api/transport.js';

export interface FederatedAttemptResponse {
  attemptId: string;
  pollSecret: string;
  authorizationUrl: string;
  expiresAt: string;
}

export interface RegistrationPreviewResponse {
  continuationId: string;
  continuationSecret: string;
  suggestedDisplayName: string;
  suggestedAvatarUrl?: string;
  legalBundleVersion: string;
  termsVersion: string;
  privacyVersion: string;
  legalLocales: string[];
  expiresAt: string;
}

export interface FederatedPollResponse {
  status: 'WAITING' | 'COMPLETION_REQUIRED' | 'DENIED' | 'CANCELLED' | 'FAILED' | 'COMPLETED' | 'REGISTRATION_REQUIRED' | 'AUTHENTICATED';
  registration?: RegistrationPreviewResponse;
  session?: IssuedSession;
}

export class FederatedAuthClient {
  constructor(private readonly transport: HttpTransport) {}

  capabilities() {
    return this.transport.request<{ github: { enabled: boolean } }>({
      method: 'GET',
      path: '/desktop/v1/auth/capabilities',
    });
  }

  createAttempt(input: { installationId: string; completionUri: string }) {
    return this.transport.request<FederatedAttemptResponse>({
      method: 'POST',
      path: '/desktop/v1/auth/federated/attempts',
      body: { provider: 'github', ...input },
    });
  }

  poll(attemptId: string, body: { pollSecret: string; completionProof?: string }) {
    return this.transport.request<FederatedPollResponse>({
      method: 'POST',
      path: `/desktop/v1/auth/federated/attempts/${attemptId}/poll`,
      body,
    });
  }

  cancel(attemptId: string, pollSecret: string) {
    return this.transport.request<void>({
      method: 'POST',
      path: `/desktop/v1/auth/federated/attempts/${attemptId}/cancel`,
      body: { pollSecret },
    });
  }

  register(body: {
    continuationId: string;
    continuationSecret: string;
    displayName: string;
    useSuggestedAvatar: boolean;
    legalBundleVersion: string;
    termsVersion: string;
    privacyVersion: string;
    locale: string;
  }) {
    return this.transport.request<FederatedPollResponse>({
      method: 'POST',
      path: '/desktop/v1/auth/federated/registrations',
      body,
    });
  }
}
