package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.access.application.CreateOrganizationWorkspace
import ai.taskpilot.coreapi.access.application.CreateWorkspaceCommand
import ai.taskpilot.coreapi.access.application.CreateWorkspaceResult
import ai.taskpilot.coreapi.access.application.ListAccessibleWorkspaces
import ai.taskpilot.coreapi.access.application.WorkspaceTemporarilyUnavailableException
import ai.taskpilot.coreapi.access.application.WorkspaceValidationException
import ai.taskpilot.coreapi.access.model.UserId
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/desktop/v1/workspaces")
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class WorkspaceController(
    private val createWorkspace: CreateOrganizationWorkspace,
    private val listWorkspaces: ListAccessibleWorkspaces,
) {
    @GetMapping
    fun list(
        @AuthenticationPrincipal principal: DesktopPrincipal,
    ): WorkspaceListResponse =
        try {
            WorkspaceListResponse.from(listWorkspaces.execute(UserId(principal.user.userId)))
        } catch (failure: WorkspaceTemporarilyUnavailableException) {
            throw AuthenticationProblemException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "WORKSPACE_TEMPORARILY_UNAVAILABLE",
                cause = failure,
            )
        }

    @PostMapping
    @ApiResponses(
        value = [
            ApiResponse(
                responseCode = "201",
                description = "Workspace created",
                content = [Content(schema = Schema(implementation = WorkspaceResponse::class))],
            ),
            ApiResponse(
                responseCode = "200",
                description = "Idempotent replay",
                content = [Content(schema = Schema(implementation = WorkspaceResponse::class))],
            ),
            ApiResponse(responseCode = "400", description = "Invalid request"),
            ApiResponse(responseCode = "401", description = "Authentication required"),
            ApiResponse(responseCode = "403", description = "Workspace creation not allowed"),
            ApiResponse(responseCode = "409", description = "Idempotency key reused with a different payload"),
            ApiResponse(responseCode = "503", description = "Workspace service temporarily unavailable"),
        ],
    )
    fun create(
        @AuthenticationPrincipal principal: DesktopPrincipal,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody body: CreateWorkspaceRequest,
    ): ResponseEntity<WorkspaceResponse> =
        when (
            val result =
                try {
                    createWorkspace.execute(
                        CreateWorkspaceCommand(
                            actor = UserId(principal.user.userId),
                            name = body.name,
                            idempotencyKey = idempotencyKey,
                        ),
                    )
                } catch (failure: WorkspaceValidationException) {
                    throw AuthenticationProblemException(
                        HttpStatus.BAD_REQUEST,
                        "VALIDATION_FAILED",
                        failure.field,
                        cause = failure,
                    )
                }
        ) {
            is CreateWorkspaceResult.Created -> {
                ResponseEntity
                    .status(HttpStatus.CREATED)
                    .body(WorkspaceResponse.from(result.workspace))
            }

            is CreateWorkspaceResult.Replayed -> {
                ResponseEntity.ok(WorkspaceResponse.from(result.workspace))
            }

            CreateWorkspaceResult.IdempotencyConflict -> {
                throw AuthenticationProblemException(
                    HttpStatus.CONFLICT,
                    "IDEMPOTENCY_KEY_REUSED",
                )
            }

            CreateWorkspaceResult.CreationNotAllowed -> {
                throw AuthenticationProblemException(
                    HttpStatus.FORBIDDEN,
                    "WORKSPACE_CREATION_NOT_ALLOWED",
                )
            }

            CreateWorkspaceResult.TemporarilyUnavailable -> {
                throw AuthenticationProblemException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "WORKSPACE_TEMPORARILY_UNAVAILABLE",
                )
            }
        }
}
