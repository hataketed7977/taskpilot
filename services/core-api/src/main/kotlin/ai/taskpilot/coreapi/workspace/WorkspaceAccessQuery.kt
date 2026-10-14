package ai.taskpilot.coreapi.workspace

import java.util.UUID

/** Narrow Workspace-owned authorization fact consumed by Project. */
fun interface WorkspaceAccessQuery {
    fun roleFor(
        userId: UUID,
        workspaceId: UUID,
    ): WorkspaceRole?
}

enum class WorkspaceRole {
    OWNER,
}
