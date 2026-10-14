package ai.taskpilot.coreapi.project.api

import ai.taskpilot.coreapi.access.DesktopActor
import ai.taskpilot.coreapi.project.CreateProjectCommand
import ai.taskpilot.coreapi.project.DeleteProjectCommand
import ai.taskpilot.coreapi.project.EditProjectCommand
import ai.taskpilot.coreapi.project.ProjectPage
import ai.taskpilot.coreapi.project.ProjectStatus
import ai.taskpilot.coreapi.project.ProjectStatusCommand
import ai.taskpilot.coreapi.project.ProjectUseCases
import ai.taskpilot.coreapi.project.ProjectView
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/desktop/v1/workspaces/{workspaceId}/projects")
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class ProjectController(
    private val projects: ProjectUseCases,
) {
    @GetMapping
    fun list(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @RequestParam(defaultValue = "ACTIVE") status: ProjectStatus,
        @RequestParam(defaultValue = "50") limit: Int,
        @RequestParam(required = false) cursor: String?,
    ): ProjectPage = projects.list(actor.userId, workspaceId, status, limit, cursor)

    @PostMapping
    fun create(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @RequestBody body: CreateProjectRequest,
    ): ResponseEntity<ProjectView> =
        ResponseEntity.status(HttpStatus.CREATED).body(
            projects.create(
                CreateProjectCommand(
                    actor.userId,
                    workspaceId,
                    body.requestId,
                    body.name,
                    body.description,
                ),
            ),
        )

    @GetMapping("/{projectId}")
    fun detail(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
    ): ProjectView = projects.detail(actor.userId, workspaceId, projectId)

    @PatchMapping("/{projectId}")
    fun edit(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @RequestBody body: EditProjectRequest,
    ): ProjectView =
        projects.edit(
            EditProjectCommand(
                actor.userId,
                workspaceId,
                projectId,
                body.expectedVersion,
                body.name,
                body.description,
            ),
        )

    @PostMapping("/{projectId}/archive")
    fun archive(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @RequestBody body: ProjectStatusRequest,
    ): ProjectView = projects.archive(ProjectStatusCommand(actor.userId, workspaceId, projectId, body.expectedVersion))

    @PostMapping("/{projectId}/restore")
    fun restore(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @RequestBody body: ProjectStatusRequest,
    ): ProjectView = projects.restore(ProjectStatusCommand(actor.userId, workspaceId, projectId, body.expectedVersion))

    @PostMapping("/{projectId}/permanent-deletion")
    fun permanentlyDelete(
        @AuthenticationPrincipal actor: DesktopActor,
        @PathVariable workspaceId: UUID,
        @PathVariable projectId: UUID,
        @RequestBody body: DeleteProjectRequest,
    ): ResponseEntity<Void> {
        projects.permanentlyDelete(
            DeleteProjectCommand(
                actor.userId,
                workspaceId,
                projectId,
                body.expectedVersion,
                body.confirmationName,
            ),
        )
        return ResponseEntity.noContent().build()
    }
}

data class CreateProjectRequest(
    val requestId: UUID,
    val name: String,
    val description: String?,
)

data class EditProjectRequest(
    val expectedVersion: Long,
    val name: String,
    val description: String?,
)

data class ProjectStatusRequest(
    val expectedVersion: Long,
)

data class DeleteProjectRequest(
    val expectedVersion: Long,
    val confirmationName: String,
)
