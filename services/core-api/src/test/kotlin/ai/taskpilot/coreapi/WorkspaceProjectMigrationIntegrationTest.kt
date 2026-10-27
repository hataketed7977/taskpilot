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
                "project.board_placements, project.board_columns, project.work_items, project.boards, " +
                "project.project_memberships, project.projects, " +
                "workspace.workspace_memberships, workspace.workspaces, " +
                "access.terms_acceptances, access.external_identities, access.users",
        )
    }

    @Test
    fun `work item baseline has content and audit facts without placeholder state`() {
        val columns =
            jdbc
                .queryForList(
                    "SELECT column_name FROM information_schema.columns " +
                        "WHERE table_schema = 'project' AND table_name = 'work_items'",
                    String::class.java,
                ).toSet()
        assertEquals(
            setOf(
                "id",
                "project_id",
                "title",
                "description",
                "version",
                "created_by_user_id",
                "create_request_id",
                "create_request_fingerprint",
                "created_at",
                "updated_at",
            ),
            columns,
        )
    }

    @Test
    fun `project work tables use uuid primary keys`() {
        val columns =
            jdbc.queryForList(
                """
                SELECT table_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'project'
                  AND table_name IN ('boards', 'board_columns', 'work_items', 'board_placements')
                  AND column_name = 'id'
                ORDER BY table_name
                """.trimIndent(),
            )
        assertEquals(
            listOf("board_columns", "board_placements", "boards", "work_items"),
            columns.map { it["table_name"] },
        )
        assertEquals(setOf("uuid"), columns.map { it["data_type"] }.toSet())
    }

    @Test
    fun `project work constraints preserve scope ordering versions and canonical content`() {
        val constraints =
            jdbc
                .query(
                    """
                    SELECT conname, pg_get_constraintdef(oid) AS definition, condeferrable, condeferred
                    FROM pg_constraint
                    WHERE connamespace = 'project'::regnamespace
                      AND conrelid IN (
                          'project.boards'::regclass,
                          'project.board_columns'::regclass,
                          'project.work_items'::regclass,
                          'project.board_placements'::regclass
                      )
                    """.trimIndent(),
                ) { rows, _ ->
                    rows.getString("conname") to
                        ConstraintDefinition(
                            rows.getString("definition"),
                            rows.getBoolean("condeferrable"),
                            rows.getBoolean("condeferred"),
                        )
                }.toMap()

        assertConstraint(constraints, "fk_board_columns__boards", "FOREIGN KEY (project_id, board_id)")
        assertConstraint(constraints, "fk_board_placements__boards", "FOREIGN KEY (project_id, board_id)")
        assertConstraint(constraints, "fk_board_placements__columns", "FOREIGN KEY (project_id, board_id, column_id)")
        assertConstraint(constraints, "fk_board_placements__work_items", "FOREIGN KEY (project_id, work_item_id)")
        assertConstraint(constraints, "uq_board_placements__board_work_item", "UNIQUE (board_id, work_item_id)")
        assertConstraint(constraints, "ck_boards__version_non_negative", "CHECK ((version >= 0))")
        assertConstraint(constraints, "ck_board_columns__position_non_negative", "CHECK ((\"position\" >= 0))")
        assertConstraint(constraints, "ck_board_columns__version_non_negative", "CHECK ((version >= 0))")
        assertConstraint(constraints, "ck_work_items__title_not_blank", "CHECK ((btrim((title)::text) <> ''::text))")
        assertConstraint(constraints, "ck_work_items__description_length", "char_length(description) <= 10000")
        assertEquals(false, constraints.containsKey("ck_work_items__lifecycle_supported"))
        assertConstraint(constraints, "ck_work_items__version_non_negative", "CHECK ((version >= 0))")
        assertConstraint(constraints, "ck_board_placements__position_non_negative", "CHECK ((\"position\" >= 0))")
        assertConstraint(constraints, "ck_board_placements__version_non_negative", "CHECK ((version >= 0))")
        assertConstraint(constraints, "ck_boards__request_fingerprint_not_blank", "create_request_fingerprint")
        assertConstraint(constraints, "ck_board_columns__request_fingerprint_not_blank", "create_request_fingerprint")
        assertConstraint(constraints, "ck_work_items__request_fingerprint_not_blank", "create_request_fingerprint")

        assertEquals(true, constraints.getValue("uq_board_columns__board_position").deferrable)
        assertEquals(false, constraints.getValue("uq_board_columns__board_position").initiallyDeferred)
        assertEquals(true, constraints.getValue("uq_board_placements__column_position").deferrable)
        assertEquals(false, constraints.getValue("uq_board_placements__column_position").initiallyDeferred)
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

    private fun assertConstraint(
        constraints: Map<String, ConstraintDefinition>,
        name: String,
        expectedFragment: String,
    ) {
        val definition = constraints[name] ?: error("Missing constraint $name")
        kotlin.test.assertTrue(
            definition.sql.contains(expectedFragment),
            "Expected $name to contain '$expectedFragment', but was '${definition.sql}'",
        )
    }

    private data class ConstraintDefinition(
        val sql: String,
        val deferrable: Boolean,
        val initiallyDeferred: Boolean,
    )

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
                "project.boards.fk_boards__projects",
                "project.boards.fk_boards__created_by_users",
                "project.board_columns.fk_board_columns__boards",
                "project.board_columns.fk_board_columns__created_by_users",
                "project.work_items.fk_work_items__projects",
                "project.work_items.fk_work_items__created_by_users",
                "project.board_placements.fk_board_placements__boards",
                "project.board_placements.fk_board_placements__columns",
                "project.board_placements.fk_board_placements__work_items",
            )
    }
}
