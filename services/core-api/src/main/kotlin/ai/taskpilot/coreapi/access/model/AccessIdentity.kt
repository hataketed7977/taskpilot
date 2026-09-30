package ai.taskpilot.coreapi.access.model

import java.time.Instant
import java.util.UUID

@JvmInline
value class UserId(
    val value: UUID,
)

@JvmInline
value class EmailIdentityId(
    val value: UUID,
)

enum class UserStatus {
    ACTIVE,
}

data class UserAccount(
    val userId: UserId,
    val displayName: String,
    val status: UserStatus,
    val createdAt: Instant,
)

data class EmailIdentity(
    val emailIdentityId: EmailIdentityId,
    val userId: UserId,
    val email: EmailAddress,
    val verifiedAt: Instant,
    val createdAt: Instant,
)

data class PasswordCredential(
    val userId: UserId,
    val digest: PasswordDigest,
    val changedAt: Instant,
)

data class TermsAcceptance(
    val userId: UserId,
    val termsVersion: String,
    val acceptedAt: Instant,
)

data class NewAccessIdentity(
    val user: UserAccount,
    val emailIdentity: EmailIdentity,
    val passwordCredential: PasswordCredential,
    val termsAcceptance: TermsAcceptance,
) {
    init {
        require(emailIdentity.userId == user.userId)
        require(passwordCredential.userId == user.userId)
        require(termsAcceptance.userId == user.userId)
    }
}
