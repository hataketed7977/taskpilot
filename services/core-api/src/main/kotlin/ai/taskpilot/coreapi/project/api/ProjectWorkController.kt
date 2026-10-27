package ai.taskpilot.coreapi.project.api

import ai.taskpilot.coreapi.access.DesktopActor
import ai.taskpilot.coreapi.project.BoardSummary
import ai.taskpilot.coreapi.project.BoardView
import ai.taskpilot.coreapi.project.CreateBoardCommand
import ai.taskpilot.coreapi.project.CreateColumnCommand
import ai.taskpilot.coreapi.project.CreateWorkItemCommand
import ai.taskpilot.coreapi.project.CreateWorkItemResult
import ai.taskpilot.coreapi.project.DeleteBoardCommand
import ai.taskpilot.coreapi.project.DeleteColumnCommand
import ai.taskpilot.coreapi.project.EditBoardCommand
import ai.taskpilot.coreapi.project.EditColumnCommand
import ai.taskpilot.coreapi.project.EditWorkItemCommand
import ai.taskpilot.coreapi.project.EditWorkItemResult
import ai.taskpilot.coreapi.project.MovePlacementCommand
import ai.taskpilot.coreapi.project.ProjectWorkUseCases
import ai.taskpilot.coreapi.project.ReorderColumnsCommand
import ai.taskpilot.coreapi.project.WorkItemView
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}")
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
@Suppress("TooManyFunctions") // One controller exposes the cohesive Project Work HTTP contract.
class ProjectWorkController(
    private val projectWork: ProjectWorkUseCases,
) {
    @GetMapping("/boards")
    fun listBoards(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
    ): List<BoardSummary> = projectWork.listBoards(actor.userId, workspaceId, projectId)

    @PostMapping("/boards")
    fun createBoard(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @RequestBody body: CreateBoardRequest,
    ): ResponseEntity<BoardView> =
        ResponseEntity.status(HttpStatus.CREATED).body(
            projectWork.createBoard(
                CreateBoardCommand(
                    actor.userId,
                    workspaceId,
                    projectId,
                    body.requestId,
                    body.name,
                    body.description,
                    body.locale,
                ),
            ),
        )

    @GetMapping("/boards/{boardId}")
    fun board(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable boardId: UUID,
    ): BoardView = projectWork.board(actor.userId, workspaceId, projectId, boardId)

    @PatchMapping("/boards/{boardId}")
    fun editBoard(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable boardId: UUID,
        @RequestBody body: EditBoardRequest,
    ): BoardView =
        projectWork.editBoard(
            EditBoardCommand(
                actor.userId,
                workspaceId,
                projectId,
                boardId,
                body.expectedVersion,
                body.name,
                body.description,
            ),
        )

    @PostMapping("/boards/{boardId}/permanent-deletion")
    fun permanentlyDeleteBoard(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable boardId: UUID,
        @RequestBody body: DeleteBoardRequest,
    ): ResponseEntity<Void> {
        projectWork.permanentlyDeleteBoard(
            DeleteBoardCommand(
                actor.userId,
                workspaceId,
                projectId,
                boardId,
                body.expectedVersion,
                body.confirmationName,
            ),
        )
        return ResponseEntity.noContent().build()
    }

    @PostMapping("/boards/{boardId}/columns")
    fun createColumn(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable boardId: UUID,
        @RequestBody body: CreateColumnRequest,
    ): ResponseEntity<BoardView> =
        ResponseEntity.status(HttpStatus.CREATED).body(
            projectWork.createColumn(
                CreateColumnCommand(
                    actor.userId,
                    workspaceId,
                    projectId,
                    boardId,
                    body.requestId,
                    body.expectedBoardVersion,
                    body.name,
                ),
            ),
        )

    @PatchMapping("/boards/{boardId}/columns/{columnId}")
    @Suppress("LongParameterList") // Path scope and version inputs stay explicit at the HTTP boundary.
    fun editColumn(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable boardId: UUID,
        @PathVariable columnId: UUID,
        @RequestBody body: EditColumnRequest,
    ): BoardView =
        projectWork.editColumn(
            EditColumnCommand(
                actor.userId,
                workspaceId,
                projectId,
                boardId,
                columnId,
                body.expectedBoardVersion,
                body.expectedColumnVersion,
                body.name,
            ),
        )

    @DeleteMapping("/boards/{boardId}/columns/{columnId}")
    @Suppress("LongParameterList") // Path scope and version inputs stay explicit at the HTTP boundary.
    fun deleteColumn(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable boardId: UUID,
        @PathVariable columnId: UUID,
        @RequestParam expectedBoardVersion: Long,
        @RequestParam expectedColumnVersion: Long,
    ): ResponseEntity<Void> {
        projectWork.deleteColumn(
            DeleteColumnCommand(
                actor.userId,
                workspaceId,
                projectId,
                boardId,
                columnId,
                expectedBoardVersion,
                expectedColumnVersion,
            ),
        )
        return ResponseEntity.noContent().build()
    }

    @PutMapping("/boards/{boardId}/column-order")
    fun reorderColumns(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable boardId: UUID,
        @RequestBody body: ReorderColumnsRequest,
    ): BoardView =
        projectWork.reorderColumns(
            ReorderColumnsCommand(
                actor.userId,
                workspaceId,
                projectId,
                boardId,
                body.expectedBoardVersion,
                body.columnIds,
            ),
        )

    @PostMapping("/boards/{boardId}/work-items")
    fun createWorkItem(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable boardId: UUID,
        @RequestBody body: CreateWorkItemRequest,
    ): ResponseEntity<CreateWorkItemResult> =
        ResponseEntity.status(HttpStatus.CREATED).body(
            projectWork.createWorkItem(
                CreateWorkItemCommand(
                    actor.userId,
                    workspaceId,
                    projectId,
                    boardId,
                    body.columnId,
                    body.requestId,
                    body.expectedBoardVersion,
                    body.title,
                    body.description,
                ),
            ),
        )

    @GetMapping("/work-items/{workItemId}")
    fun workItem(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable workItemId: UUID,
    ): WorkItemView = projectWork.workItem(actor.userId, workspaceId, projectId, workItemId)

    @PatchMapping("/work-items/{workItemId}")
    fun editWorkItem(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable workItemId: UUID,
        @RequestBody body: EditWorkItemRequest,
    ): EditWorkItemResult =
        projectWork.editWorkItem(
            EditWorkItemCommand(
                actor.userId,
                workspaceId,
                projectId,
                workItemId,
                body.boardId,
                body.currentColumnId,
                body.targetColumnId,
                body.expectedBoardVersion,
                body.expectedPlacementVersion,
                body.expectedVersion,
                body.title,
                body.description,
            ),
        )

    @PostMapping("/boards/{boardId}/placements/{workItemId}/move")
    @Suppress("LongParameterList") // Path scope and version inputs stay explicit at the HTTP boundary.
    fun movePlacement(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @PathVariable boardId: UUID,
        @PathVariable workItemId: UUID,
        @RequestBody body: MovePlacementRequest,
    ): BoardView =
        projectWork.movePlacement(
            MovePlacementCommand(
                actor.userId,
                workspaceId,
                projectId,
                boardId,
                workItemId,
                body.expectedBoardVersion,
                body.expectedPlacementVersion,
                body.targetColumnId,
                body.beforeWorkItemId,
            ),
        )
}

data class CreateBoardRequest(
    val requestId: UUID,
    val name: String,
    val description: String?,
    val locale: String,
)

data class EditBoardRequest(
    val expectedVersion: Long,
    val name: String,
    val description: String?,
)

data class DeleteBoardRequest(
    val expectedVersion: Long,
    val confirmationName: String,
)

data class CreateColumnRequest(
    val requestId: UUID,
    val expectedBoardVersion: Long,
    val name: String,
)

data class EditColumnRequest(
    val expectedBoardVersion: Long,
    val expectedColumnVersion: Long,
    val name: String,
)

data class ReorderColumnsRequest(
    val expectedBoardVersion: Long,
    val columnIds: List<UUID>,
)

data class CreateWorkItemRequest(
    val requestId: UUID,
    val expectedBoardVersion: Long,
    val columnId: UUID,
    val title: String,
    val description: String?,
)

data class EditWorkItemRequest(
    val boardId: UUID,
    val currentColumnId: UUID,
    val targetColumnId: UUID,
    val expectedBoardVersion: Long? = null,
    val expectedPlacementVersion: Long? = null,
    val expectedVersion: Long,
    val title: String,
    val description: String?,
)

data class MovePlacementRequest(
    val expectedBoardVersion: Long,
    val expectedPlacementVersion: Long,
    val targetColumnId: UUID,
    val beforeWorkItemId: UUID?,
)
