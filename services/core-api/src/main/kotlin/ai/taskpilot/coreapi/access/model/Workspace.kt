package ai.taskpilot.coreapi.access.model

import java.util.UUID

@JvmInline
value class WorkspaceId(
    val value: UUID,
)

enum class WorkspaceType {
    ORGANIZATION,
    PERSONAL,
}

data class Workspace(
    val workspaceId: WorkspaceId,
    val name: String,
    val type: WorkspaceType,
)
