package ai.taskpilot.coreapi.access.model

import java.time.Instant
import java.util.UUID

@JvmInline
value class UserId(
    val value: UUID,
)

enum class UserStatus {
    ACTIVE,
    DISABLED,
}

data class UserAccount(
    val userId: UserId,
    val displayName: String,
    val status: UserStatus,
    val createdAt: Instant,
    val avatarUrl: java.net.URI? = null,
)

@JvmInline
value class TermsAcceptanceId(
    val value: UUID,
)

data class TermsAcceptance(
    val termsAcceptanceId: TermsAcceptanceId,
    val userId: UserId,
    val legalBundleVersion: String,
    val termsVersion: String,
    val privacyVersion: String,
    val locale: String,
    val acceptedAt: Instant,
)
