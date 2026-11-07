package ai.taskpilot.coreapi.project.api

import ai.taskpilot.contract.generated.api.ProjectWorkApi
import ai.taskpilot.contract.generated.model.BoardSummary
import ai.taskpilot.contract.generated.model.BoardView
import ai.taskpilot.contract.generated.model.CreateBoardRequest
import ai.taskpilot.contract.generated.model.CreateColumnRequest
import ai.taskpilot.contract.generated.model.CreateWorkItemRequest
import ai.taskpilot.contract.generated.model.CreateWorkItemResult
import ai.taskpilot.contract.generated.model.DeleteBoardRequest
import ai.taskpilot.contract.generated.model.EditBoardRequest
import ai.taskpilot.contract.generated.model.EditColumnRequest
import ai.taskpilot.contract.generated.model.EditWorkItemRequest
import ai.taskpilot.contract.generated.model.EditWorkItemResult
import ai.taskpilot.contract.generated.model.MovePlacementRequest
import ai.taskpilot.contract.generated.model.ProjectMemberList
import ai.taskpilot.contract.generated.model.ReorderColumnsRequest
import ai.taskpilot.contract.generated.model.WorkItemView
import ai.taskpilot.coreapi.currentAuthenticatedActor
import ai.taskpilot.coreapi.project.AssigneePatch
import ai.taskpilot.coreapi.project.AssigneePatchAction
import ai.taskpilot.coreapi.project.AssigneeSelection
import ai.taskpilot.coreapi.project.CreateBoardCommand
import ai.taskpilot.coreapi.project.CreateColumnCommand
import ai.taskpilot.coreapi.project.CreateWorkItemCommand
import ai.taskpilot.coreapi.project.DeleteBoardCommand
import ai.taskpilot.coreapi.project.DeleteColumnCommand
import ai.taskpilot.coreapi.project.DescriptionPatch
import ai.taskpilot.coreapi.project.DescriptionPatchAction
import ai.taskpilot.coreapi.project.EditBoardCommand
import ai.taskpilot.coreapi.project.EditColumnCommand
import ai.taskpilot.coreapi.project.EditWorkItemCommand
import ai.taskpilot.coreapi.project.MovePlacementCommand
import ai.taskpilot.coreapi.project.ProjectResourceScope
import ai.taskpilot.coreapi.project.ProjectWorkUseCases
import ai.taskpilot.coreapi.project.ReorderColumnsCommand
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
@Suppress("TooManyFunctions")
class ProjectWorkController(
    private val projectWork: ProjectWorkUseCases,
    private val scopes: ProjectResourceScope,
) : ProjectWorkApi {
    override fun listBoards(projectId: UUID): ResponseEntity<List<BoardSummary>> {
        val scope = scopes.project(projectId)
        val boards = projectWork.listBoards(currentAuthenticatedActor().userId, scope.workspaceId, projectId)
        return ResponseEntity.ok(boards.map { it.toWireResponse() })
    }

    override fun listProjectMembers(projectId: UUID): ResponseEntity<ProjectMemberList> {
        val scope = scopes.project(projectId)
        val members = projectWork.listProjectMembers(currentAuthenticatedActor().userId, scope.workspaceId, projectId)
        return ResponseEntity.ok(members.toWireResponse())
    }

    override fun createBoard(
        projectId: UUID,
        createBoardRequest: CreateBoardRequest,
    ): ResponseEntity<BoardView> {
        val scope = scopes.project(projectId)
        val created =
            projectWork.createBoard(
                CreateBoardCommand(
                    currentAuthenticatedActor().userId,
                    scope.workspaceId,
                    projectId,
                    createBoardRequest.requestId,
                    createBoardRequest.name,
                    createBoardRequest.description,
                    createBoardRequest.locale,
                ),
            )
        return ResponseEntity.status(HttpStatus.CREATED).body(created.toWireResponse())
    }

    override fun board(boardId: UUID): ResponseEntity<BoardView> {
        val scope = scopes.board(boardId)
        val board = projectWork.board(currentAuthenticatedActor().userId, scope.workspaceId, scope.projectId, boardId)
        return ResponseEntity.ok(board.toWireResponse())
    }

    override fun editBoard(
        boardId: UUID,
        editBoardRequest: EditBoardRequest,
    ): ResponseEntity<BoardView> {
        val scope = scopes.board(boardId)
        val board =
            projectWork.editBoard(
                EditBoardCommand(
                    currentAuthenticatedActor().userId,
                    scope.workspaceId,
                    scope.projectId,
                    boardId,
                    editBoardRequest.expectedVersion,
                    editBoardRequest.name,
                    editBoardRequest.descriptionPatch?.let {
                        DescriptionPatch(DescriptionPatchAction.valueOf(it.action.value), it.value)
                    },
                ),
            )
        return ResponseEntity.ok(board.toWireResponse())
    }

    override fun permanentlyDeleteBoard(
        boardId: UUID,
        deleteBoardRequest: DeleteBoardRequest,
    ): ResponseEntity<Unit> {
        val scope = scopes.board(boardId)
        projectWork.permanentlyDeleteBoard(
            DeleteBoardCommand(
                currentAuthenticatedActor().userId,
                scope.workspaceId,
                scope.projectId,
                boardId,
                deleteBoardRequest.expectedVersion,
                deleteBoardRequest.confirmationName,
            ),
        )
        return ResponseEntity.noContent().build()
    }

    override fun createColumn(
        boardId: UUID,
        createColumnRequest: CreateColumnRequest,
    ): ResponseEntity<BoardView> {
        val scope = scopes.board(boardId)
        val board =
            projectWork.createColumn(
                CreateColumnCommand(
                    currentAuthenticatedActor().userId,
                    scope.workspaceId,
                    scope.projectId,
                    boardId,
                    createColumnRequest.requestId,
                    createColumnRequest.expectedBoardVersion,
                    createColumnRequest.name,
                ),
            )
        return ResponseEntity.status(HttpStatus.CREATED).body(board.toWireResponse())
    }

    override fun editColumn(
        columnId: UUID,
        editColumnRequest: EditColumnRequest,
    ): ResponseEntity<BoardView> {
        val scope = scopes.column(columnId)
        val board =
            projectWork.editColumn(
                EditColumnCommand(
                    currentAuthenticatedActor().userId,
                    scope.workspaceId,
                    scope.projectId,
                    scope.boardId,
                    columnId,
                    editColumnRequest.expectedBoardVersion,
                    editColumnRequest.expectedColumnVersion,
                    editColumnRequest.name,
                ),
            )
        return ResponseEntity.ok(board.toWireResponse())
    }

    override fun deleteColumn(
        columnId: UUID,
        expectedBoardVersion: Long,
        expectedColumnVersion: Long,
    ): ResponseEntity<Unit> {
        val scope = scopes.column(columnId)
        projectWork.deleteColumn(
            DeleteColumnCommand(
                currentAuthenticatedActor().userId,
                scope.workspaceId,
                scope.projectId,
                scope.boardId,
                columnId,
                expectedBoardVersion,
                expectedColumnVersion,
            ),
        )
        return ResponseEntity.noContent().build()
    }

    override fun reorderColumns(
        boardId: UUID,
        reorderColumnsRequest: ReorderColumnsRequest,
    ): ResponseEntity<BoardView> {
        val scope = scopes.board(boardId)
        val board =
            projectWork.reorderColumns(
                ReorderColumnsCommand(
                    currentAuthenticatedActor().userId,
                    scope.workspaceId,
                    scope.projectId,
                    boardId,
                    reorderColumnsRequest.expectedBoardVersion,
                    reorderColumnsRequest.columnIds,
                ),
            )
        return ResponseEntity.ok(board.toWireResponse())
    }

    override fun createWorkItem(
        boardId: UUID,
        createWorkItemRequest: CreateWorkItemRequest,
    ): ResponseEntity<CreateWorkItemResult> {
        val scope = scopes.board(boardId)
        val result =
            projectWork.createWorkItem(
                CreateWorkItemCommand(
                    currentAuthenticatedActor().userId,
                    scope.workspaceId,
                    scope.projectId,
                    boardId,
                    createWorkItemRequest.columnId,
                    createWorkItemRequest.requestId,
                    createWorkItemRequest.expectedBoardVersion,
                    createWorkItemRequest.title,
                    createWorkItemRequest.description,
                    createWorkItemRequest.assignee?.let {
                        AssigneeSelection(it.targetType.value, it.projectMemberId)
                    },
                ),
            )
        return ResponseEntity.status(HttpStatus.CREATED).body(result.toWireResponse())
    }

    override fun workItem(workItemId: UUID): ResponseEntity<WorkItemView> {
        val scope = scopes.workItem(workItemId)
        val item = projectWork.workItem(currentAuthenticatedActor().userId, scope.workspaceId, scope.projectId, workItemId)
        return ResponseEntity.ok(item.toWireResponse())
    }

    override fun editWorkItem(
        workItemId: UUID,
        editWorkItemRequest: EditWorkItemRequest,
    ): ResponseEntity<EditWorkItemResult> {
        val scope = scopes.workItem(workItemId)
        val result =
            projectWork.editWorkItem(
                EditWorkItemCommand(
                    currentAuthenticatedActor().userId,
                    scope.workspaceId,
                    scope.projectId,
                    workItemId,
                    editWorkItemRequest.boardId,
                    editWorkItemRequest.currentColumnId,
                    editWorkItemRequest.targetColumnId,
                    editWorkItemRequest.expectedBoardVersion,
                    editWorkItemRequest.expectedPlacementVersion,
                    editWorkItemRequest.expectedVersion,
                    editWorkItemRequest.title,
                    editWorkItemRequest.descriptionPatch?.let {
                        DescriptionPatch(DescriptionPatchAction.valueOf(it.action.value), it.value)
                    },
                    editWorkItemRequest.assigneePatch?.let { patch ->
                        AssigneePatch(
                            AssigneePatchAction.valueOf(patch.action.value),
                            patch.target?.let { target -> AssigneeSelection(target.targetType.value, target.projectMemberId) },
                        )
                    },
                ),
            )
        return ResponseEntity.ok(result.toWireResponse())
    }

    override fun movePlacement(
        boardId: UUID,
        workItemId: UUID,
        movePlacementRequest: MovePlacementRequest,
    ): ResponseEntity<BoardView> {
        val scope = scopes.board(boardId)
        val board =
            projectWork.movePlacement(
                MovePlacementCommand(
                    currentAuthenticatedActor().userId,
                    scope.workspaceId,
                    scope.projectId,
                    boardId,
                    workItemId,
                    movePlacementRequest.expectedBoardVersion,
                    movePlacementRequest.expectedPlacementVersion,
                    movePlacementRequest.targetColumnId,
                    movePlacementRequest.beforeWorkItemId,
                ),
            )
        return ResponseEntity.ok(board.toWireResponse())
    }
}
