package ai.taskpilot.coreapi.access.application

import java.util.UUID

data class RefreshSessionCommand(
    val refreshToken: String,
    val refreshRequestId: UUID,
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
    fun refresh(command: RefreshSessionCommand): RefreshSessionResult

    fun currentUser(accessToken: String): CurrentUserResult

    fun logout(accessToken: String)
}
