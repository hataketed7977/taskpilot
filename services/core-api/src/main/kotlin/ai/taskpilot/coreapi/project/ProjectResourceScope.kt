package ai.taskpilot.coreapi.project

import java.util.UUID

/** Authoritative persisted ownership for canonical stable-id transport paths. */
interface ProjectResourceScope {
    fun project(projectId: UUID): ProjectScope

    fun board(boardId: UUID): BoardScope

    fun column(columnId: UUID): ColumnScope

    fun workItem(workItemId: UUID): ProjectScope
}

data class ProjectScope(
    val workspaceId: UUID,
    val projectId: UUID,
)

data class BoardScope(
    val workspaceId: UUID,
    val projectId: UUID,
    val boardId: UUID,
)

data class ColumnScope(
    val workspaceId: UUID,
    val projectId: UUID,
    val boardId: UUID,
    val columnId: UUID,
)
