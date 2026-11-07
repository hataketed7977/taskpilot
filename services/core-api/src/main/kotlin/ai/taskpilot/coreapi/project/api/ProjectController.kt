package ai.taskpilot.coreapi.project.api

import ai.taskpilot.contract.generated.api.ProjectApi
import ai.taskpilot.contract.generated.model.CreateProjectRequest
import ai.taskpilot.contract.generated.model.DeleteProjectRequest
import ai.taskpilot.contract.generated.model.EditProjectRequest
import ai.taskpilot.contract.generated.model.ProjectPage
import ai.taskpilot.contract.generated.model.ProjectStatusRequest
import ai.taskpilot.contract.generated.model.ProjectView
import ai.taskpilot.coreapi.currentAuthenticatedActor
import ai.taskpilot.coreapi.project.CreateProjectCommand
import ai.taskpilot.coreapi.project.DeleteProjectCommand
import ai.taskpilot.coreapi.project.DescriptionPatch
import ai.taskpilot.coreapi.project.DescriptionPatchAction
import ai.taskpilot.coreapi.project.EditProjectCommand
import ai.taskpilot.coreapi.project.ProjectResourceScope
import ai.taskpilot.coreapi.project.ProjectStatus
import ai.taskpilot.coreapi.project.ProjectStatusCommand
import ai.taskpilot.coreapi.project.ProjectUseCases
import ai.taskpilot.coreapi.project.ProjectValidationFailed
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class ProjectController(
    private val projects: ProjectUseCases,
    private val scopes: ProjectResourceScope,
) : ProjectApi {
    override fun list(
        workspaceId: UUID,
        status: String,
        limit: Int,
        cursor: String?,
    ): ResponseEntity<ProjectPage> {
        val projectStatus =
            ProjectStatus.entries.firstOrNull { it.name == status }
                ?: throw ProjectValidationFailed("status")
        val page = projects.list(currentAuthenticatedActor().userId, workspaceId, projectStatus, limit, cursor)
        return ResponseEntity.ok(page.toWireResponse())
    }

    override fun create(
        workspaceId: UUID,
        createProjectRequest: CreateProjectRequest,
    ): ResponseEntity<ProjectView> {
        val actor = currentAuthenticatedActor()
        val created =
            projects.create(
                CreateProjectCommand(
                    actor.userId,
                    workspaceId,
                    createProjectRequest.requestId,
                    createProjectRequest.name,
                    createProjectRequest.description,
                    createProjectRequest.locale ?: "en",
                ),
            )
        return ResponseEntity.status(HttpStatus.CREATED).body(created.toWireResponse())
    }

    override fun detail(projectId: UUID): ResponseEntity<ProjectView> {
        val scope = scopes.project(projectId)
        val project = projects.detail(currentAuthenticatedActor().userId, scope.workspaceId, projectId)
        return ResponseEntity.ok(project.toWireResponse())
    }

    override fun edit(
        projectId: UUID,
        editProjectRequest: EditProjectRequest,
    ): ResponseEntity<ProjectView> {
        val scope = scopes.project(projectId)
        val edited =
            projects.edit(
                EditProjectCommand(
                    currentAuthenticatedActor().userId,
                    scope.workspaceId,
                    projectId,
                    editProjectRequest.expectedVersion,
                    editProjectRequest.name,
                    editProjectRequest.descriptionPatch?.let {
                        DescriptionPatch(DescriptionPatchAction.valueOf(it.action.value), it.value)
                    },
                ),
            )
        return ResponseEntity.ok(edited.toWireResponse())
    }

    override fun archive(
        projectId: UUID,
        projectStatusRequest: ProjectStatusRequest,
    ): ResponseEntity<ProjectView> = projectStatusChange(projectId, projectStatusRequest, projects::archive)

    override fun restore(
        projectId: UUID,
        projectStatusRequest: ProjectStatusRequest,
    ): ResponseEntity<ProjectView> = projectStatusChange(projectId, projectStatusRequest, projects::restore)

    override fun permanentlyDelete(
        projectId: UUID,
        deleteProjectRequest: DeleteProjectRequest,
    ): ResponseEntity<Unit> {
        val scope = scopes.project(projectId)
        projects.permanentlyDelete(
            DeleteProjectCommand(
                currentAuthenticatedActor().userId,
                scope.workspaceId,
                projectId,
                deleteProjectRequest.expectedVersion,
                deleteProjectRequest.confirmationName,
            ),
        )
        return ResponseEntity.noContent().build()
    }

    private fun projectStatusChange(
        projectId: UUID,
        request: ProjectStatusRequest,
        operation: (ProjectStatusCommand) -> ai.taskpilot.coreapi.project.ProjectView,
    ): ResponseEntity<ProjectView> {
        val scope = scopes.project(projectId)
        val command = ProjectStatusCommand(currentAuthenticatedActor().userId, scope.workspaceId, projectId, request.expectedVersion)
        return ResponseEntity.ok(operation(command).toWireResponse())
    }
}
