package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.persistence.JdbcWorkspaceStore
import ai.taskpilot.coreapi.project.application.ListProjects
import ai.taskpilot.coreapi.project.application.ListProjectsResult
import ai.taskpilot.coreapi.project.persistence.JdbcProjectListStore
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.postgresql.PostgreSQLContainer
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ProjectListIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer
    private lateinit var dataSource: DataSource
    private lateinit var jdbc: JdbcTemplate
    private lateinit var listProjects: ListProjects
    private lateinit var user: UUID
    private lateinit var workspace: UUID

    @BeforeAll
    fun start() {
        postgres = PostgreSQLContainer("postgres:17-alpine")
        postgres.start()
        dataSource = DriverManagerDataSource(postgres.jdbcUrl, postgres.username, postgres.password)
        Flyway
            .configure()
            .dataSource(dataSource)
            .locations("classpath:db/migration")
            .load()
            .migrate()
        jdbc = JdbcTemplate(dataSource)
        listProjects = ListProjects(JdbcWorkspaceStore(dataSource), JdbcProjectListStore(dataSource))
    }

    @AfterAll fun stop() = postgres.stop()

    @BeforeEach
    fun reset() {
        jdbc.execute(
            """
            TRUNCATE project_memberships, projects, workspace_creation_requests,
                     workspace_memberships, workspaces, refresh_recoveries, user_sessions,
                     auth_continuations, verification_challenges, verification_rate_limits,
                     terms_acceptances, password_credentials, email_identities, app_users
            """.trimIndent(),
        )
        user = UUID.randomUUID()
        workspace = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO app_users(user_id, display_name, status, created_at) " +
                "VALUES (?, 'Reader', 'ACTIVE', ?)",
            user,
            now(),
        )
        jdbc.update(
            "INSERT INTO workspaces(workspace_id, name, workspace_type, created_at) " +
                "VALUES (?, 'Workspace', 'ORGANIZATION', ?)",
            workspace,
            now(),
        )
        jdbc.update(
            "INSERT INTO workspace_memberships(workspace_id, user_id, joined_at) VALUES (?, ?, ?)",
            workspace,
            user,
            now(),
        )
    }

    @Test
    fun `returns only project membership subset in an authorized workspace and paginates`() {
        val accessible = insertProject(workspace, "Accessible", member = true)
        insertProject(workspace, "Hidden", member = false)
        val second = insertProject(workspace, "Second", member = true)

        val first = assertIs<ListProjectsResult.Found>(listProjects.execute(user, workspace, null, 1)).page
        assertEquals(1, first.items.size)
        val next = requireNotNull(first.nextCursor)
        val rest = assertIs<ListProjectsResult.Found>(listProjects.execute(user, workspace, next, 10)).page
        assertEquals(setOf(accessible, second), (first.items + rest.items).map { it.projectId.value }.toSet())
    }

    @Test
    fun `authorized workspace with no project membership is a real empty collection`() {
        insertProject(workspace, "Not mine", member = false)
        val result = assertIs<ListProjectsResult.Found>(listProjects.execute(user, workspace, null, 50))
        assertEquals(emptyList(), result.page.items)
        assertEquals(null, result.page.nextCursor)
    }

    @Test
    fun `missing and unauthorized workspace share one not found result`() {
        assertEquals(ListProjectsResult.WorkspaceNotFound, listProjects.execute(user, UUID.randomUUID(), null, 50))
        assertEquals(ListProjectsResult.WorkspaceNotFound, listProjects.execute(UUID.randomUUID(), workspace, null, 50))
    }

    @Test
    fun `database rejects cross workspace project membership`() {
        val otherWorkspace = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO workspaces(workspace_id, name, workspace_type, created_at) " +
                "VALUES (?, 'Other', 'ORGANIZATION', ?)",
            otherWorkspace,
            now(),
        )
        jdbc.update(
            "INSERT INTO workspace_memberships(workspace_id, user_id, joined_at) VALUES (?, ?, ?)",
            otherWorkspace,
            user,
            now(),
        )
        val project = insertProject(workspace, "Scoped", member = false)
        assertFailsWith<DataIntegrityViolationException> {
            jdbc.update(
                "INSERT INTO project_memberships(project_id, workspace_id, user_id, joined_at) VALUES (?, ?, ?, ?)",
                project,
                otherWorkspace,
                user,
                now(),
            )
        }
    }

    private fun insertProject(
        workspaceId: UUID,
        name: String,
        member: Boolean,
    ): UUID {
        val project = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO projects(project_id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)",
            project,
            workspaceId,
            name,
            now(),
        )
        if (member) {
            jdbc.update(
                "INSERT INTO project_memberships(project_id, workspace_id, user_id, joined_at) VALUES (?, ?, ?, ?)",
                project,
                workspaceId,
                user,
                now(),
            )
        }
        return project
    }

    private fun now() = OffsetDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC)
}
