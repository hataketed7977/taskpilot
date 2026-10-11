package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.UserId
import java.net.URI
import java.time.Instant
import java.util.UUID

@JvmInline
value class SessionId(
    val value: UUID,
)

@JvmInline
value class SessionFamilyId(
    val value: UUID,
)

data class CurrentUserView(
    val userId: UserId,
    val displayName: String,
    val avatarUrl: URI?,
)

data class IssuedSession(
    val sessionId: SessionId,
    val familyId: SessionFamilyId,
    val accessToken: String,
    val accessTokenExpiresAt: Instant,
    val refreshToken: String,
    val refreshTokenExpiresAt: Instant,
    val currentUser: CurrentUserView,
) {
    override fun toString(): String =
        "IssuedSession(sessionId=[REDACTED], familyId=[REDACTED], accessToken=[REDACTED], " +
            "accessTokenExpiresAt=$accessTokenExpiresAt, refreshToken=[REDACTED], " +
            "refreshTokenExpiresAt=$refreshTokenExpiresAt, currentUser=$currentUser)"
}
