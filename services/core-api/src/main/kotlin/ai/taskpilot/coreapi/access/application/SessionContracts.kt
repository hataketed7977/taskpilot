package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.UserId
import java.net.URI

data class SessionUser(
    val userId: UserId,
    val displayName: String,
    val avatarUrl: URI?,
)

sealed interface RefreshSessionResult {
    data class Refreshed(
        val session: IssuedSession,
    ) : RefreshSessionResult

    data object AuthenticationRequired : RefreshSessionResult
}

sealed interface CurrentUserResult {
    data class Authenticated(
        val currentUser: CurrentUserView,
    ) : CurrentUserResult

    data object AuthenticationRequired : CurrentUserResult
}

interface SessionUseCases {
    fun issue(user: SessionUser): IssuedSession

    fun refresh(refreshToken: String): RefreshSessionResult

    fun currentUser(accessToken: String): CurrentUserResult

    fun logout(accessToken: String)
}
