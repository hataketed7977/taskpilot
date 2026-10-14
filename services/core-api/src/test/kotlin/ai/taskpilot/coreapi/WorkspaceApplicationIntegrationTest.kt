package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.workspace.WorkspaceRole
import ai.taskpilot.coreapi.workspace.WorkspaceType
import ai.taskpilot.coreapi.workspace.infrastructure.JdbcWorkspaceAccessService
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.postgresql.PostgreSQLContainer
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WorkspaceApplicationIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer
    private lateinit var jdbc: JdbcTemplate
    private lateinit var service: JdbcWorkspaceAccessService
    private val now = Instant.parse("2026-10-14T08:00:00Z")

    @BeforeAll
    fun startPostgreSql() {
        postgres = PostgreSQLContainer("postgres:17-alpine")
        postgres.start()
        val dataSource: DataSource = DriverManagerDataSource(postgres.jdbcUrl, postgres.username, postgres.password)
        Flyway
            .configure()
            .dataSource(dataSource)
            .locations("classpath:db/migration")
            .load()
            .migrate()
        jdbc = JdbcTemplate(dataSource)
        service = JdbcWorkspaceAccessService(dataSource)
    }

    @AfterAll
    fun stopPostgreSql() = postgres.stop()

    @BeforeEach
    fun reset() {
        jdbc.execute(
            "TRUNCATE project.project_memberships, project.projects, workspace.workspace_memberships, " +
                "workspace.workspaces, access.terms_acceptances, access.external_identities, access.users CASCADE",
        )
    }

    @Test
    fun `active user reads only their personal workspace and owner relationship`() {
        val owner = fixtureUser("Owner")
        val other = fixtureUser("Other")
        val workspace = fixtureWorkspace(owner, "PERSONAL")
        fixtureWorkspace(other, "PERSONAL")
        fixtureWorkspace(owner, "TEAM")

        val result = service.listFor(owner)

        assertEquals(1, result.size)
        assertEquals(workspace, result.single().workspaceId)
        assertEquals(WorkspaceType.PERSONAL, result.single().type)
        assertEquals(WorkspaceRole.OWNER, result.single().role)
        assertEquals(now, result.single().createdAt)
        assertEquals(now, result.single().updatedAt)
    }

    @Test
    fun `workspace authorization does not read access user status`() {
        val owner = fixtureUser("Owner")
        fixtureWorkspace(owner, "PERSONAL")
        jdbc.update("UPDATE access.users SET status = 'DISABLED' WHERE id = ?", owner)

        assertEquals(1, service.listFor(owner).size)
    }

    private fun fixtureUser(name: String): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO access.users (id, display_name, avatar_url, status, created_at) " +
                "VALUES (?, ?, NULL, 'ACTIVE', ?)",
            id,
            name,
            now.atOffset(ZoneOffset.UTC),
        )
        return id
    }

    private fun fixtureWorkspace(
        ownerId: UUID,
        type: String,
    ): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO workspace.workspaces (id, type, personal_owner_user_id, created_at, updated_at) " +
                "VALUES (?, ?, ?, ?, ?)",
            id,
            type,
            if (type == "PERSONAL") ownerId else null,
            now.atOffset(ZoneOffset.UTC),
            now.atOffset(ZoneOffset.UTC),
        )
        jdbc.update(
            "INSERT INTO workspace.workspace_memberships (id, workspace_id, user_id, role, created_at) " +
                "VALUES (?, ?, ?, 'OWNER', ?)",
            UUID.randomUUID(),
            id,
            ownerId,
            now.atOffset(ZoneOffset.UTC),
        )
        return id
    }
}
