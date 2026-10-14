package ai.taskpilot.coreapi

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
import java.sql.Connection
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WorkspaceProjectMigrationIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer
    private lateinit var jdbc: JdbcTemplate

    @BeforeAll
    fun startPostgreSql() {
        postgres = PostgreSQLContainer("postgres:17-alpine")
        postgres.start()
        val dataSource = DriverManagerDataSource(postgres.jdbcUrl, postgres.username, postgres.password)
        Flyway
            .configure()
            .dataSource(dataSource)
            .locations("classpath:db/migration")
            .load()
            .migrate()
        jdbc = JdbcTemplate(dataSource)
    }

    @AfterAll
    fun stopPostgreSql() = postgres.stop()

    @BeforeEach
    fun resetDatabase() {
        jdbc.execute(
            "TRUNCATE TABLE " +
                "project.project_memberships, project.projects, " +
                "workspace.workspace_memberships, workspace.workspaces, " +
                "access.terms_acceptances, access.external_identities, access.users",
        )
    }

    @Test
    fun `one user can own exactly one personal workspace while team is a reserved type`() {
        val ownerId = insertUser()
        insertWorkspace(ownerId = ownerId)

        assertFailsWith<DataIntegrityViolationException> {
            insertWorkspace(ownerId = ownerId)
        }
        assertFailsWith<DataIntegrityViolationException> {
            insertWorkspace(type = "PERSONAL", ownerId = null)
        }
        assertFailsWith<DataIntegrityViolationException> {
            insertWorkspace(type = "TEAM", ownerId = ownerId)
        }

        insertWorkspace(type = "TEAM", ownerId = null)
    }

    @Test
    fun `workspace and project memberships are unique per user and currently accept only owner`() {
        val userId = insertUser()
        val workspaceId = insertWorkspace(ownerId = userId)
        insertWorkspaceMembership(workspaceId, userId)

        assertFailsWith<DataIntegrityViolationException> {
            insertWorkspaceMembership(workspaceId, userId)
        }
        assertFailsWith<DataIntegrityViolationException> {
            insertWorkspaceMembership(workspaceId, insertUser(), role = "MEMBER")
        }

        val projectId = insertProject(workspaceId, userId, TestProject(name = "Same name"))
        insertProjectMembership(projectId, userId)

        assertFailsWith<DataIntegrityViolationException> {
            insertProjectMembership(projectId, userId)
        }
        assertFailsWith<DataIntegrityViolationException> {
            insertProjectMembership(projectId, insertUser(), role = "MEMBER")
        }
    }

    @Test
    fun `duplicate project names are allowed but create request is idempotent per actor and workspace`() {
        val userId = insertUser()
        val workspaceId = insertWorkspace(ownerId = userId)

        insertProject(workspaceId, userId, TestProject(name = "Repeated"))
        insertProject(workspaceId, userId, TestProject(name = "Repeated"))

        val requestId = UUID.randomUUID()
        insertProject(workspaceId, userId, TestProject(requestId = requestId))
        assertFailsWith<DataIntegrityViolationException> {
            insertProject(workspaceId, userId, TestProject(requestId = requestId))
        }
    }

    @Test
    fun `project columns enforce canonical content version and archive state`() {
        val userId = insertUser()
        val workspaceId = insertWorkspace(ownerId = userId)

        assertFailsWith<DataIntegrityViolationException> {
            insertProject(workspaceId, userId, TestProject(name = "   "))
        }
        assertFailsWith<DataIntegrityViolationException> {
            insertProject(workspaceId, userId, TestProject(description = null))
        }
        assertFailsWith<DataIntegrityViolationException> {
            insertProject(workspaceId, userId, TestProject(version = -1))
        }
        assertFailsWith<DataIntegrityViolationException> {
            insertProject(workspaceId, userId, TestProject(status = "ACTIVE", archived = true))
        }
        assertFailsWith<DataIntegrityViolationException> {
            insertProject(workspaceId, userId, TestProject(status = "ARCHIVED", archived = false))
        }
    }

    @Test
    fun `all business foreign keys restrict implicit deletion`() {
        val deleteRules =
            postgres.createConnection("").use { connection -> foreignKeyDeleteRules(connection) }

        assertEquals(EXPECTED_RESTRICTED_FOREIGN_KEYS, deleteRules.keys)
        assertEquals(setOf("RESTRICT"), deleteRules.values.toSet())
    }

    @Test
    fun `project membership blocks implicit project deletion`() {
        val userId = insertUser()
        val workspaceId = insertWorkspace(ownerId = userId)
        val projectId = insertProject(workspaceId, userId)
        insertProjectMembership(projectId, userId)

        assertFailsWith<DataIntegrityViolationException> {
            jdbc.update("DELETE FROM project.projects WHERE id = ?", projectId)
        }
    }

    private fun insertUser(): UUID =
        UUID.randomUUID().also { id ->
            jdbc.update(
                "INSERT INTO access.users (id, display_name, status, created_at) VALUES (?, 'Owner', 'ACTIVE', now())",
                id,
            )
        }

    private fun insertWorkspace(
        type: String = "PERSONAL",
        ownerId: UUID?,
    ): UUID =
        UUID.randomUUID().also { id ->
            jdbc.update(
                "INSERT INTO workspace.workspaces " +
                    "(id, type, personal_owner_user_id, created_at, updated_at) VALUES (?, ?, ?, now(), now())",
                id,
                type,
                ownerId,
            )
        }

    private fun insertWorkspaceMembership(
        workspaceId: UUID,
        userId: UUID,
        role: String = "OWNER",
    ) {
        jdbc.update(
            "INSERT INTO workspace.workspace_memberships " +
                "(id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, now())",
            UUID.randomUUID(),
            workspaceId,
            userId,
            role,
        )
    }

    private fun insertProject(
        workspaceId: UUID,
        userId: UUID,
        project: TestProject = TestProject(),
    ): UUID =
        UUID.randomUUID().also { id ->
            jdbc.update(
                "INSERT INTO project.projects " +
                    "(id, workspace_id, name, description, status, version, created_by_user_id, " +
                    "create_request_id, create_request_fingerprint, created_at, updated_at, archived_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test-fingerprint', now(), now(), " +
                    "CASE WHEN ? THEN now() ELSE NULL END)",
                id,
                workspaceId,
                project.name,
                project.description,
                project.status,
                project.version,
                userId,
                project.requestId,
                project.archived,
            )
        }

    private data class TestProject(
        val name: String = "My project",
        val description: String? = "",
        val status: String = "ACTIVE",
        val version: Long = 0,
        val archived: Boolean = false,
        val requestId: UUID = UUID.randomUUID(),
    )

    private fun insertProjectMembership(
        projectId: UUID,
        userId: UUID,
        role: String = "OWNER",
    ) {
        jdbc.update(
            "INSERT INTO project.project_memberships " +
                "(id, project_id, user_id, role, created_at) VALUES (?, ?, ?, ?, now())",
            UUID.randomUUID(),
            projectId,
            userId,
            role,
        )
    }

    private fun foreignKeyDeleteRules(connection: Connection): Map<String, String> =
        connection
            .prepareStatement(
                """
                SELECT source_namespace.nspname || '.' || source_relation.relname || '.' ||
                       constraint_definition.conname AS foreign_key,
                       CASE constraint_definition.confdeltype
                           WHEN 'r' THEN 'RESTRICT'
                           WHEN 'a' THEN 'NO ACTION'
                           WHEN 'c' THEN 'CASCADE'
                           WHEN 'n' THEN 'SET NULL'
                           WHEN 'd' THEN 'SET DEFAULT'
                       END AS delete_rule
                FROM pg_constraint constraint_definition
                JOIN pg_class source_relation ON source_relation.oid = constraint_definition.conrelid
                JOIN pg_namespace source_namespace ON source_namespace.oid = source_relation.relnamespace
                WHERE constraint_definition.contype = 'f'
                  AND source_namespace.nspname IN ('access', 'workspace', 'project')
                ORDER BY foreign_key
                """.trimIndent(),
            ).use { statement ->
                statement.executeQuery().use { rows ->
                    buildMap {
                        while (rows.next()) put(rows.getString("foreign_key"), rows.getString("delete_rule"))
                    }
                }
            }

    companion object {
        private val EXPECTED_RESTRICTED_FOREIGN_KEYS =
            setOf(
                "access.external_identities.fk_external_identities__users",
                "access.terms_acceptances.fk_terms_acceptances__users",
                "workspace.workspace_memberships.fk_workspace_memberships__users",
                "workspace.workspace_memberships.fk_workspace_memberships__workspaces",
                "workspace.workspaces.fk_workspaces__personal_owner_users",
                "project.project_memberships.fk_project_memberships__projects",
                "project.project_memberships.fk_project_memberships__users",
                "project.projects.fk_projects__created_by_users",
                "project.projects.fk_projects__workspaces",
            )
    }
}
