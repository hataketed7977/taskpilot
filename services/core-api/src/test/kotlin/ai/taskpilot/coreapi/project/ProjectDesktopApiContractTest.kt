package ai.taskpilot.coreapi.project

import ai.taskpilot.coreapi.access.AuthenticatedActor
import ai.taskpilot.coreapi.access.api.CORRELATION_ID_ATTRIBUTE
import ai.taskpilot.coreapi.project.api.ProjectController
import ai.taskpilot.coreapi.project.api.ProjectProblemException
import ai.taskpilot.coreapi.project.api.ProjectProblemHandler
import ai.taskpilot.coreapi.project.application.ListProjects
import ai.taskpilot.coreapi.project.application.ProjectListStore
import ai.taskpilot.coreapi.project.application.ProjectListStoreUnavailableException
import jakarta.servlet.http.HttpServletRequest
import java.lang.reflect.Proxy
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ProjectDesktopApiContractTest {
    @Test
    fun `temporary project store failure maps to stable 503 problem`() {
        val controller =
            ProjectController(
                ListProjects(
                    authorizer = { _, _ -> true },
                    store = unavailableStore(),
                ),
            )
        val failure =
            assertFailsWith<ProjectProblemException> {
                controller.list(actor(), UUID.randomUUID(), null, 50, request())
            }

        assertEquals(503, failure.status.value())
        assertEquals("PROJECTS_TEMPORARILY_UNAVAILABLE", failure.code)
        val response = ProjectProblemHandler().handle(failure, request())
        assertEquals(503, response.statusCode.value())
        assertEquals("PROJECTS_TEMPORARILY_UNAVAILABLE", response.body?.properties?.get("code"))
        assertEquals("correlation-id", response.body?.properties?.get("correlationId"))
    }

    private fun actor(): AuthenticatedActor =
        object : AuthenticatedActor {
            override val userId: UUID = UUID.randomUUID()
        }

    private fun unavailableStore(): ProjectListStore =
        object : ProjectListStore {
            override fun list(
                actor: UUID,
                workspaceId: UUID,
                afterProjectId: UUID?,
                limit: Int,
            ) = throw ProjectListStoreUnavailableException()
        }

    private fun request(): HttpServletRequest =
        Proxy.newProxyInstance(
            javaClass.classLoader,
            arrayOf(HttpServletRequest::class.java),
        ) { _, method, arguments ->
            when (method.name) {
                "getParameterMap" -> emptyMap<String, Array<String>>()
                "getRequestURI" -> "/desktop/v1/workspaces/workspace-id/projects"
                "getAttribute" -> if (arguments?.singleOrNull() == CORRELATION_ID_ATTRIBUTE) "correlation-id" else null
                else -> null
            }
        } as HttpServletRequest
}
