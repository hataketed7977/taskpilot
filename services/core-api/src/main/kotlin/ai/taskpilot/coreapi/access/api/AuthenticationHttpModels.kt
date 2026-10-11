package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.IssuedSession
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.net.URI
import java.time.Instant
import java.util.UUID

data class RefreshRequest(
    @field:NotBlank @field:Size(max = 512) val refreshToken: String,
)

data class CurrentUserResponse(
    val userId: UUID,
    val displayName: String,
    val avatarUrl: URI?,
) {
    companion object {
        fun from(view: CurrentUserView) = CurrentUserResponse(view.userId.value, view.displayName, view.avatarUrl)
    }
}

data class SessionResponse(
    val accessToken: String,
    val accessTokenExpiresAt: Instant,
    val refreshToken: String,
    val refreshTokenExpiresAt: Instant,
    val currentUser: CurrentUserResponse,
) {
    companion object {
        fun from(session: IssuedSession) =
            SessionResponse(
                session.accessToken,
                session.accessTokenExpiresAt,
                session.refreshToken,
                session.refreshTokenExpiresAt,
                CurrentUserResponse.from(session.currentUser),
            )
    }
}
