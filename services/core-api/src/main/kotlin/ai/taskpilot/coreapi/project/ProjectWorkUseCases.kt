package ai.taskpilot.coreapi.project

import java.time.Instant
import java.util.UUID

data class BoardSummary(
    val boardId: UUID,
    val projectId: UUID,
    val name: String,
    val description: String,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class BoardColumnView(
    val columnId: UUID,
    val name: String,
    val position: Long,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant,
    val cards: List<CardView>,
)

data class CardView(
    val workItemId: UUID,
    val title: String,
    val description: String,
    val lifecycle: String,
    val workItemVersion: Long,
    val placementVersion: Long,
    val position: Long,
)

data class BoardView(
    val boardId: UUID,
    val projectId: UUID,
    val name: String,
    val description: String,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant,
    val columns: List<BoardColumnView>,
)

data class WorkItemView(
    val workItemId: UUID,
    val projectId: UUID,
    val title: String,
    val description: String,
    val lifecycle: String,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CreateBoardCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val requestId: UUID,
    val name: String,
    val description: String?,
    val locale: String,
)

data class EditBoardCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val boardId: UUID,
    val expectedVersion: Long,
    val name: String,
    val description: String?,
)

data class CreateColumnCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val boardId: UUID,
    val requestId: UUID,
    val expectedBoardVersion: Long,
    val name: String,
)

data class EditColumnCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val boardId: UUID,
    val columnId: UUID,
    val expectedBoardVersion: Long,
    val expectedColumnVersion: Long,
    val name: String,
)

data class ReorderColumnsCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val boardId: UUID,
    val expectedBoardVersion: Long,
    val columnIds: List<UUID>,
)

data class DeleteColumnCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val boardId: UUID,
    val columnId: UUID,
    val expectedBoardVersion: Long,
    val expectedColumnVersion: Long,
)

data class CreateWorkItemCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val boardId: UUID,
    val columnId: UUID,
    val requestId: UUID,
    val expectedBoardVersion: Long,
    val title: String,
    val description: String?,
)

data class CreateWorkItemResult(
    val workItem: WorkItemView,
    val board: BoardView,
)

data class EditWorkItemCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val workItemId: UUID,
    val boardId: UUID,
    val currentColumnId: UUID,
    val targetColumnId: UUID,
    val expectedBoardVersion: Long?,
    val expectedPlacementVersion: Long?,
    val expectedVersion: Long,
    val title: String,
    val description: String?,
)

data class EditWorkItemResult(
    val workItem: WorkItemView,
    val board: BoardView,
)

data class MovePlacementCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val boardId: UUID,
    val workItemId: UUID,
    val expectedBoardVersion: Long,
    val expectedPlacementVersion: Long,
    val targetColumnId: UUID,
    val beforeWorkItemId: UUID?,
)

@Suppress("TooManyFunctions") // Cohesive Board, Column, Work Item, and Placement application contract.
interface ProjectWorkUseCases {
    fun listBoards(
        actorUserId: UUID,
        workspaceId: UUID,
        projectId: UUID,
    ): List<BoardSummary>

    fun board(
        actorUserId: UUID,
        workspaceId: UUID,
        projectId: UUID,
        boardId: UUID,
    ): BoardView

    fun createBoard(command: CreateBoardCommand): BoardView

    fun editBoard(command: EditBoardCommand): BoardView

    fun createColumn(command: CreateColumnCommand): BoardView

    fun editColumn(command: EditColumnCommand): BoardView

    fun reorderColumns(command: ReorderColumnsCommand): BoardView

    fun deleteColumn(command: DeleteColumnCommand)

    fun createWorkItem(command: CreateWorkItemCommand): CreateWorkItemResult

    fun workItem(
        actorUserId: UUID,
        workspaceId: UUID,
        projectId: UUID,
        workItemId: UUID,
    ): WorkItemView

    fun editWorkItem(command: EditWorkItemCommand): EditWorkItemResult

    fun movePlacement(command: MovePlacementCommand): BoardView
}

sealed class ProjectWorkFailure(
    message: String,
) : RuntimeException(message)

class ProjectWorkNotFound : ProjectWorkFailure("PROJECT_NOT_FOUND")

class ProjectWorkValidationFailed(
    val path: String,
) : ProjectWorkFailure("VALIDATION_FAILED")

class ProjectWorkIdempotencyConflict : ProjectWorkFailure("IDEMPOTENCY_CONFLICT")

class BoardVersionConflict : ProjectWorkFailure("BOARD_VERSION_CONFLICT")

class ProjectResourceVersionConflict : ProjectWorkFailure("RESOURCE_VERSION_CONFLICT")

class ColumnNotEmptyConflict : ProjectWorkFailure("COLUMN_NOT_EMPTY")

class LastColumnConflict : ProjectWorkFailure("LAST_COLUMN")

class PlacementConflict : ProjectWorkFailure("PLACEMENT_CONFLICT")
