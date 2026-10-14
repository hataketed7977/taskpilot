package ai.taskpilot.coreapi.project.api

import ai.taskpilot.coreapi.access.DesktopActor
import ai.taskpilot.coreapi.access.api.AuthenticationProblemHandler
import ai.taskpilot.coreapi.project.CreateProjectCommand
import ai.taskpilot.coreapi.project.DeleteProjectCommand
import ai.taskpilot.coreapi.project.EditProjectCommand
import ai.taskpilot.coreapi.project.ProjectPage
import ai.taskpilot.coreapi.project.ProjectStatus
import ai.taskpilot.coreapi.project.ProjectStatusCommand
import ai.taskpilot.coreapi.project.ProjectUseCases
import ai.taskpilot.coreapi.project.ProjectView
import org.junit.jupiter.api.Test
import org.springframework.core.MethodParameter
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.bind.support.WebDataBinderFactory
import org.springframework.web.context.request.NativeWebRequest
import org.springframework.web.method.support.HandlerMethodArgumentResolver
import org.springframework.web.method.support.ModelAndViewContainer
import java.util.UUID

class ProjectProblemHandlerTest {
    @Test
    fun `database failure from Project controller uses the temporary-unavailable contract`() {
        val projects = FailingProjectUseCases(DataAccessResourceFailureException("database secret"))
        val mockMvc =
            MockMvcBuilders
                .standaloneSetup(ProjectController(projects))
                .setControllerAdvice(ProjectProblemHandler(), AuthenticationProblemHandler())
                .setCustomArgumentResolvers(DesktopActorArgumentResolver)
                .build()

        mockMvc
            .get("/desktop/v1/workspaces/{workspaceId}/projects", UUID.randomUUID())
            .andExpect {
                status { isServiceUnavailable() }
                jsonPath("$.code") { value("TEMPORARILY_UNAVAILABLE") }
                jsonPath("$.detail") { value("The service is temporarily unavailable.") }
            }
    }
}

private object DesktopActorArgumentResolver : HandlerMethodArgumentResolver {
    private val actor =
        object : DesktopActor {
            override val userId: UUID = UUID.randomUUID()
        }

    override fun supportsParameter(parameter: MethodParameter): Boolean = parameter.parameterType == DesktopActor::class.java

    override fun resolveArgument(
        parameter: MethodParameter,
        mavContainer: ModelAndViewContainer?,
        webRequest: NativeWebRequest,
        binderFactory: WebDataBinderFactory?,
    ): Any = actor
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
