package ai.taskpilot.coreapi.project.api

import ai.taskpilot.coreapi.access.AuthenticatedActor
import ai.taskpilot.coreapi.project.application.ListProjects
import ai.taskpilot.coreapi.project.application.ListProjectsResult
import ai.taskpilot.coreapi.project.application.ProjectPage
import ai.taskpilot.coreapi.project.application.ProjectQueryValidationException
import ai.taskpilot.coreapi.project.model.ProjectSummary
import com.fasterxml.jackson.annotation.JsonInclude
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class ProjectResponse(
    val projectId: UUID,
    val workspaceId: UUID,
    val name: String,
) {
    companion object {
        fun from(project: ProjectSummary) = ProjectResponse(project.projectId.value, project.workspaceId, project.name)
    }
}

@JsonInclude(JsonInclude.Include.NON_NULL)
data class ProjectPageResponse(
    val items: List<ProjectResponse>,
    val nextCursor: String? = null,
) {
    companion object {
        fun from(page: ProjectPage) = ProjectPageResponse(page.items.map(ProjectResponse::from), page.nextCursor)
    }
}

@RestController
@RequestMapping("/desktop/v1/workspaces/{workspaceId}/projects")
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class ProjectController(
    private val listProjects: ListProjects,
) {
    @GetMapping
    fun list(
        @AuthenticationPrincipal principal: AuthenticatedActor,
        @PathVariable workspaceId: UUID,
        @RequestParam(required = false) cursor: String?,
        @Suppress("MagicNumber")
        @RequestParam(defaultValue = "50")
        @Min(1)
        @Max(100) limit: Int,
        request: HttpServletRequest,
    ): ProjectPageResponse =
        try {
            validateQuery(request)
            mapResult(listProjects.execute(principal.userId, workspaceId, cursor, limit))
        } catch (failure: ProjectQueryValidationException) {
            throw ProjectProblemException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", failure)
        }

    private fun validateQuery(request: HttpServletRequest) {
        if (request.parameterMap.keys.any { it !in ALLOWED_QUERY_PARAMETERS } ||
            request.parameterMap.values.any { it.size != 1 }
        ) {
            throw ProjectQueryValidationException("Only one cursor and limit query parameter are allowed")
        }
    }

    private fun mapResult(result: ListProjectsResult): ProjectPageResponse =
        when (result) {
            is ListProjectsResult.Found -> {
                ProjectPageResponse.from(result.page)
            }

            ListProjectsResult.WorkspaceNotFound -> {
                throw ProjectProblemException(HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND")
            }

            ListProjectsResult.TemporarilyUnavailable -> {
                throw ProjectProblemException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "PROJECTS_TEMPORARILY_UNAVAILABLE",
                )
            }
        }

    private companion object {
        val ALLOWED_QUERY_PARAMETERS = setOf("cursor", "limit")
    }
}
