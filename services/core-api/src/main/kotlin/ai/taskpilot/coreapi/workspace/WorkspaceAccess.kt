package ai.taskpilot.coreapi.workspace

import java.time.Instant
import java.util.UUID

interface WorkspaceUseCases {
    fun listFor(userId: UUID): List<WorkspaceView>
}

data class WorkspaceView(
    val workspaceId: UUID,
    val type: WorkspaceType,
    val role: WorkspaceRole,
    val createdAt: Instant,
    val updatedAt: Instant,
)

enum class WorkspaceType {
    PERSONAL,
    TEAM,
}
