package ai.taskpilot.coreapi.project.api

import ai.taskpilot.coreapi.access.DesktopActor
import ai.taskpilot.coreapi.access.api.AuthenticationProblemHandler
import ai.taskpilot.coreapi.project.BoardScope
import ai.taskpilot.coreapi.project.ColumnScope
import ai.taskpilot.coreapi.project.CreateProjectCommand
import ai.taskpilot.coreapi.project.DeleteProjectCommand
import ai.taskpilot.coreapi.project.EditProjectCommand
import ai.taskpilot.coreapi.project.ProjectPage
import ai.taskpilot.coreapi.project.ProjectResourceScope
import ai.taskpilot.coreapi.project.ProjectScope
import ai.taskpilot.coreapi.project.ProjectStatus
import ai.taskpilot.coreapi.project.ProjectStatusCommand
import ai.taskpilot.coreapi.project.ProjectUseCases
import ai.taskpilot.coreapi.project.ProjectView
import org.junit.jupiter.api.Test
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.util.UUID

class ProjectProblemHandlerTest {
    @Test
    fun `database failure from Project controller uses the temporary-unavailable contract`() {
        val projects = FailingProjectUseCases(DataAccessResourceFailureException("database secret"))
        val mockMvc =
            MockMvcBuilders
                .standaloneSetup(ProjectController(projects, UnusedProjectResourceScope))
                .setControllerAdvice(ProjectProblemHandler(), AuthenticationProblemHandler())
                .build()
        SecurityContextHolder.getContext().authentication =
            UsernamePasswordAuthenticationToken.authenticated(TestActor, null, emptyList())

        try {
            mockMvc
                .get("/v1/workspaces/{workspaceId}/projects", UUID.randomUUID())
                .andExpect {
                    status { isServiceUnavailable() }
                    jsonPath("$.code") { value("TEMPORARILY_UNAVAILABLE") }
                    jsonPath("$.detail") { value("The service is temporarily unavailable.") }
                }
        } finally {
            SecurityContextHolder.clearContext()
        }
    }
}

private object TestActor : DesktopActor {
    override val userId: UUID = UUID.randomUUID()
}

private class FailingProjectUseCases(
    private val failure: RuntimeException,
) : ProjectUseCases {
    override fun list(
        actorUserId: UUID,
        workspaceId: UUID,
        status: ProjectStatus,
        limit: Int,
        cursor: String?,
    ): ProjectPage = throw failure

    override fun detail(
        actorUserId: UUID,
        workspaceId: UUID,
        projectId: UUID,
    ): ProjectView = throw failure

    override fun create(command: CreateProjectCommand): ProjectView = throw failure

    override fun edit(command: EditProjectCommand): ProjectView = throw failure

    override fun archive(command: ProjectStatusCommand): ProjectView = throw failure

    override fun restore(command: ProjectStatusCommand): ProjectView = throw failure

    override fun permanentlyDelete(command: DeleteProjectCommand): Unit = throw failure
}

private object UnusedProjectResourceScope : ProjectResourceScope {
    override fun project(projectId: UUID) = ProjectScope(UUID.randomUUID(), projectId)

    override fun board(boardId: UUID) = error("unused")

    override fun column(columnId: UUID) = error("unused")

    override fun workItem(workItemId: UUID) = error("unused")
}
