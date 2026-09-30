package ai.taskpilot.coreapi.project

import ai.taskpilot.coreapi.access.WorkspaceAuthorizationUnavailableException
import ai.taskpilot.coreapi.project.application.ListProjects
import ai.taskpilot.coreapi.project.application.ListProjectsResult
import ai.taskpilot.coreapi.project.application.ProjectCursor
import ai.taskpilot.coreapi.project.application.ProjectListStore
import ai.taskpilot.coreapi.project.application.ProjectListStoreUnavailableException
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ProjectCursorTest {
    @Test
    fun `cursor round trips only inside its workspace scope`() {
        val workspace = UUID.randomUUID()
        val project = UUID.randomUUID()
        val cursor = ProjectCursor.encode(workspace, project)
        assertEquals(project, ProjectCursor.decode(cursor, workspace))
        assertFailsWith<IllegalArgumentException> { ProjectCursor.decode(cursor, UUID.randomUUID()) }
        assertFailsWith<IllegalArgumentException> { ProjectCursor.decode("not-a-cursor", workspace) }
    }

    @Test
    fun `authorization and query availability failures are fail closed`() {
        val actor = UUID.randomUUID()
        val workspace = UUID.randomUUID()
        val queryFailure =
            ListProjects(
                authorizer = { _, _ -> true },
                store = unavailableStore(),
            )
        assertEquals(
            ListProjectsResult.TemporarilyUnavailable,
            queryFailure.execute(actor, workspace, null, 50),
        )

        val authorizationFailure =
            ListProjects(
                authorizer = { _, _ -> throw WorkspaceAuthorizationUnavailableException() },
                store = unavailableStore(),
            )
        assertEquals(
            ListProjectsResult.TemporarilyUnavailable,
            authorizationFailure.execute(actor, workspace, null, 50),
        )
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
}
