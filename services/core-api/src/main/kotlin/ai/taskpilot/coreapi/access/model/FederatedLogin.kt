package ai.taskpilot.coreapi.access.model

import java.net.URI
import java.time.Instant
import java.util.UUID

@JvmInline
value class ExternalIdentityId(
    val value: UUID,
)

@JvmInline
value class AttemptId(
    val value: UUID,
)

@JvmInline
value class ContinuationId(
    val value: UUID,
)

data class ExternalIdentityKey(
    val provider: String,
    val authority: URI,
    val subject: String,
) {
    init {
        require(provider.isNotBlank())
        require(authority.isAbsolute)
        require(subject.isNotBlank())
    }
}

data class ExternalIdentity(
    val externalIdentityId: ExternalIdentityId,
    val userId: UserId,
    val key: ExternalIdentityKey,
    val linkedAt: Instant,
    val lastAuthenticatedAt: Instant,
)

data class NewFederatedUser(
    val user: UserAccount,
    val externalIdentity: ExternalIdentity,
    val termsAcceptance: TermsAcceptance,
) {
    init {
        require(externalIdentity.userId == user.userId)
        require(termsAcceptance.userId == user.userId)
    }
}

enum class FederatedLoginAttemptStatus {
    PENDING,
    CALLBACK_PROCESSING,
    COMPLETION_PENDING,
    IDENTITY_PROCESSING,
    REGISTRATION_PENDING,
    REGISTRATION_PROCESSING,
    DENIED,
    FAILED,
    CANCELLED,
    EXPIRED,
    COMPLETED,
}

data class FederatedLoginAttempt(
    val attemptId: AttemptId,
    val provider: String,
    val installationId: String,
    val completionUri: URI,
    val pollSecretDigest: String,
    val oauthStateDigest: String,
    val encryptedPkceVerifier: ByteArray,
    val status: FederatedLoginAttemptStatus,
    val createdAt: Instant,
    val expiresAt: Instant,
)

data class FederatedUserProfile(
    val userId: UserId,
    val displayName: String,
    val avatarUrl: URI?,
    val status: UserStatus,
)

data class FederatedCallbackClaim(
    val attemptId: AttemptId,
    val completionUri: URI,
    val encryptedPkceVerifier: ByteArray,
)

data class FederatedAttemptView(
    val attemptId: AttemptId,
    val status: FederatedLoginAttemptStatus,
    val encryptedIdentityCandidate: ByteArray?,
    val encryptedResult: ByteArray?,
    val expiresAt: Instant,
)

data class FederatedRegistrationClaim(
    val attemptId: AttemptId,
    val encryptedIdentityCandidate: ByteArray,
)
