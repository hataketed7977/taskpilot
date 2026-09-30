package ai.taskpilot.coreapi.access

import java.util.UUID

interface AuthenticatedActor {
    val userId: UUID
}

fun interface WorkspaceMembershipAuthorizer {
    fun canAccess(
        userId: UUID,
        workspaceId: UUID,
    ): Boolean
}

class WorkspaceAuthorizationUnavailableException(
    cause: Throwable? = null,
) : RuntimeException("Workspace authorization unavailable", cause)
