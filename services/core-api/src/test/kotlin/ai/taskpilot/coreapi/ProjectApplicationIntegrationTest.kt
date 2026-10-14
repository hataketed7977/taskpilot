package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.project.CreateProjectCommand
import ai.taskpilot.coreapi.project.DeleteProjectCommand
import ai.taskpilot.coreapi.project.EditProjectCommand
import ai.taskpilot.coreapi.project.ProjectDeleteRestricted
import ai.taskpilot.coreapi.project.ProjectIdempotencyConflict
import ai.taskpilot.coreapi.project.ProjectNameConfirmationMismatch
import ai.taskpilot.coreapi.project.ProjectNotFound
import ai.taskpilot.coreapi.project.ProjectStatus
import ai.taskpilot.coreapi.project.ProjectStatusCommand
import ai.taskpilot.coreapi.project.ProjectValidationFailed
import ai.taskpilot.coreapi.project.ProjectVersionConflict
import ai.taskpilot.coreapi.project.WorkspaceNotFound
import ai.taskpilot.coreapi.project.internal.ProjectApplicationService
import ai.taskpilot.coreapi.workspace.WorkspaceAccessQuery
import ai.taskpilot.coreapi.workspace.WorkspaceRole
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.postgresql.PostgreSQLContainer
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ProjectApplicationIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer
    private lateinit var dataSource: DataSource
    private lateinit var jdbc: JdbcTemplate
    private lateinit var transactions: TransactionTemplate
    private lateinit var service: ProjectApplicationService
    private val now = Instant.parse("2026-10-14T08:00:00Z")

    @BeforeAll
    fun startPostgreSql() {
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
        transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        service =
            ProjectApplicationService(
                dataSource,
                JdbcWorkspaceAccessQuery(dataSource),
                Clock.fixed(now, ZoneOffset.UTC),
                DataSourceTransactionManager(dataSource),
            )
    }

    @AfterAll
    fun stopPostgreSql() = postgres.stop()

    @BeforeEach
    fun reset() {
        jdbc.execute("DROP TABLE IF EXISTS project.protected_project_children")
        jdbc.execute(
            "TRUNCATE project.project_memberships, project.projects, workspace.workspace_memberships, " +
                "workspace.workspaces, access.terms_acceptances, access.external_identities, access.users CASCADE",
        )
    }

    @Test
    fun `workspace scope protects deterministic project list and detail`() {
        val owner = fixtureUser("Owner")
        val other = fixtureUser("Other")
        val workspace = fixtureWorkspace(owner)
        val otherWorkspace = fixtureWorkspace(other)
        val first = fixtureProject(workspace, owner, "First", now.minusSeconds(10))
        val second = fixtureProject(workspace, owner, "Second", now)
        fixtureProject(otherWorkspace, other, "Hidden", now.minusSeconds(20))

        val firstPage = service.list(owner, workspace, ProjectStatus.ACTIVE, 1, null)
        val secondPage = service.list(owner, workspace, ProjectStatus.ACTIVE, 1, firstPage.nextCursor)

        assertEquals(listOf(first), firstPage.items.map { it.projectId })
        assertEquals(listOf(second), secondPage.items.map { it.projectId })
        assertEquals(second, service.detail(owner, workspace, second).projectId)
        assertFailsWith<WorkspaceNotFound> {
            service.list(owner, otherWorkspace, ProjectStatus.ACTIVE, 20, null)
        }
        assertFailsWith<ProjectNotFound> { service.detail(owner, workspace, fixtureProject(otherWorkspace, other, "X", now)) }
    }

    @Test
    fun `workspace owner creates duplicate names and receives project owner atomically`() {
        val owner = fixtureUser("Owner")
        val workspace = fixtureWorkspace(owner)

        val first = service.create(createCommand(owner, workspace, UUID.randomUUID(), " Same ", " Notes "))
        val second = service.create(createCommand(owner, workspace, UUID.randomUUID(), "Same", "Notes"))

        assertNotEquals(first.projectId, second.projectId)
        assertEquals("Same", first.name)
        assertEquals("Notes", first.description)
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM project.projects", Int::class.java))
        assertEquals(
            2,
            jdbc.queryForObject(
                "SELECT count(*) FROM project.project_memberships WHERE user_id = ? AND role = 'OWNER'",
                Int::class.java,
                owner,
            ),
        )
    }

    @Test
    fun `create requires active workspace owner but no preexisting project membership`() {
        val owner = fixtureUser("Owner")
        val outsider = fixtureUser("Outsider")
        val workspace = fixtureWorkspace(owner)

        assertFailsWith<WorkspaceNotFound> {
            service.create(createCommand(outsider, workspace, UUID.randomUUID(), "Denied", null))
        }
        jdbc.update("UPDATE access.users SET status = 'DISABLED' WHERE id = ?", owner)
        assertFailsWith<WorkspaceNotFound> {
            service.create(createCommand(owner, workspace, UUID.randomUUID(), "Denied", null))
        }
    }

    @Test
    fun `project input validates unicode code point boundaries after trimming`() {
        val owner = fixtureUser("Owner")
        val workspace = fixtureWorkspace(owner)

        assertEquals("x", service.create(createCommand(owner, workspace, UUID.randomUUID(), " x ", null)).name)
        assertEquals(
            200,
            service.create(createCommand(owner, workspace, UUID.randomUUID(), "😀".repeat(200), null)).name.codePointCount(0, 400),
        )
        assertEquals(
            2000,
            service
                .create(
                    createCommand(owner, workspace, UUID.randomUUID(), "Description", "😀".repeat(2000)),
                ).description
                .codePointCount(0, 4000),
        )

        assertValidationPath("name") { service.create(createCommand(owner, workspace, UUID.randomUUID(), " ", null)) }
        assertValidationPath("name") { service.create(createCommand(owner, workspace, UUID.randomUUID(), "😀".repeat(201), null)) }
        assertValidationPath("description") {
            service.create(createCommand(owner, workspace, UUID.randomUUID(), "Description", "😀".repeat(2001)))
        }
    }

    @Test
    fun `cursor rejects malformed cross workspace and cross status reuse`() {
        val owner = fixtureUser("Owner")
        val other = fixtureUser("Other")
        val workspace = fixtureWorkspace(owner)
        val otherWorkspace = fixtureWorkspace(other)
        fixtureWorkspaceMembership(otherWorkspace, owner)
        fixtureProject(workspace, owner, "First", now.minusSeconds(1))
        fixtureProject(workspace, owner, "Second", now)
        fixtureProject(otherWorkspace, owner, "Other first", now.minusSeconds(1))
        fixtureProject(otherWorkspace, owner, "Other second", now)
        val cursor = service.list(owner, workspace, ProjectStatus.ACTIVE, 1, null).nextCursor!!

        assertValidationPath("cursor") { service.list(owner, workspace, ProjectStatus.ACTIVE, 1, "not-a-cursor") }
        assertValidationPath("cursor") { service.list(owner, otherWorkspace, ProjectStatus.ACTIVE, 1, cursor) }
        assertValidationPath("cursor") { service.list(owner, workspace, ProjectStatus.ARCHIVED, 1, cursor) }
    }

    @Test
    fun `request id replay returns same project and changed payload conflicts`() {
        val owner = fixtureUser("Owner")
        val workspace = fixtureWorkspace(owner)
        val requestId = UUID.randomUUID()
        val command = createCommand(owner, workspace, requestId, "Project", "Description")

        val first = service.create(command)
        val replay = service.create(command)

        assertEquals(first, replay)
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM project.projects", Int::class.java))
        assertFailsWith<ProjectIdempotencyConflict> {
            service.create(command.copy(description = "Changed"))
        }
    }

    @Test
    fun `concurrent request id replay creates one project`() {
        val owner = fixtureUser("Owner")
        val workspace = fixtureWorkspace(owner)
        val command = createCommand(owner, workspace, UUID.randomUUID(), "Concurrent", null)
        val start = java.util.concurrent.CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val futures =
                (1..2).map {
                    pool.submit(
                        Callable {
                            start.await(5, TimeUnit.SECONDS)
                            service.create(command)
                        },
                    )
                }
            start.countDown()
            val results = futures.map { it.get(10, TimeUnit.SECONDS) }

            assertEquals(1, results.map { it.projectId }.distinct().size)
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM project.projects", Int::class.java))
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM project.project_memberships", Int::class.java))
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `project list breaks equal timestamps by project id`() {
        val owner = fixtureUser("Owner")
        val workspace = fixtureWorkspace(owner)
        val lowerId = UUID.fromString("00000000-0000-0000-0000-000000000001")
        val higherId = UUID.fromString("00000000-0000-0000-0000-000000000002")
        fixtureProject(workspace, owner, "Second", now, higherId)
        fixtureProject(workspace, owner, "First", now, lowerId)

        val listed = service.list(owner, workspace, ProjectStatus.ACTIVE, 20, null).items.map { it.projectId }

        assertEquals(listOf(lowerId, higherId), listed)
    }

    @Test
    fun `archive and restore enforce owner version list isolation and idempotent retry`() {
        val owner = fixtureUser("Owner")
        val member = fixtureUser("Member")
        val workspace = fixtureWorkspace(owner)
        fixtureWorkspaceMembership(workspace, member)
        val projectId = fixtureProject(workspace, owner, "Lifecycle", now)

        assertFailsWith<ProjectNotFound> {
            service.archive(ProjectStatusCommand(member, workspace, projectId, 0))
        }
        val archived = service.archive(ProjectStatusCommand(owner, workspace, projectId, 0))
        assertEquals(ProjectStatus.ARCHIVED, archived.status)
        assertEquals(1, archived.version)
        assertEquals(now, archived.archivedAt)
        assertTrue(service.list(owner, workspace, ProjectStatus.ACTIVE, 20, null).items.isEmpty())
        assertEquals(listOf(projectId), service.list(owner, workspace, ProjectStatus.ARCHIVED, 20, null).items.map { it.projectId })

        val archiveReplay = service.archive(ProjectStatusCommand(owner, workspace, projectId, 0))
        assertEquals(archived, archiveReplay)
        assertFailsWith<ProjectVersionConflict> {
            service.restore(ProjectStatusCommand(owner, workspace, projectId, 0))
        }
        val restored = service.restore(ProjectStatusCommand(owner, workspace, projectId, 1))
        assertEquals(ProjectStatus.ACTIVE, restored.status)
        assertEquals(2, restored.version)
        assertEquals(null, restored.archivedAt)
        assertEquals(restored, service.restore(ProjectStatusCommand(owner, workspace, projectId, 1)))
        assertValidationPath("expectedVersion") {
            service.archive(ProjectStatusCommand(owner, workspace, projectId, -1))
        }
    }

    @Test
    fun `permanent deletion validates owner version exact current name and preserves workspace`() {
        val owner = fixtureUser("Owner")
        val member = fixtureUser("Member")
        val workspace = fixtureWorkspace(owner)
        fixtureWorkspaceMembership(workspace, member)
        val active = fixtureProject(workspace, owner, "Exact name", now)
        val archived = fixtureProject(workspace, owner, "Archived", now.plusSeconds(1))
        service.archive(ProjectStatusCommand(owner, workspace, archived, 0))

        assertFailsWith<ProjectNotFound> {
            service.permanentlyDelete(DeleteProjectCommand(member, workspace, active, 0, "Exact name"))
        }
        assertFailsWith<ProjectNameConfirmationMismatch> {
            service.permanentlyDelete(DeleteProjectCommand(owner, workspace, active, 0, " exact name "))
        }
        service.edit(EditProjectCommand(owner, workspace, active, 0, "Renamed", null))
        assertFailsWith<ProjectVersionConflict> {
            service.permanentlyDelete(DeleteProjectCommand(owner, workspace, active, 0, "Exact name"))
        }
        service.permanentlyDelete(DeleteProjectCommand(owner, workspace, active, 1, "Renamed"))
        service.permanentlyDelete(DeleteProjectCommand(owner, workspace, archived, 1, "Archived"))

        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM project.projects", Int::class.java))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM project.project_memberships", Int::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM workspace.workspaces WHERE id = ?", Int::class.java, workspace))
        assertFailsWith<ProjectNotFound> { service.detail(owner, workspace, active) }
    }

    @Test
    fun `protected project dependency restricts deletion and rolls membership deletion back`() {
        val owner = fixtureUser("Owner")
        val workspace = fixtureWorkspace(owner)
        val projectId = fixtureProject(workspace, owner, "Protected", now)
        jdbc.execute(
            "CREATE TABLE project.protected_project_children (" +
                "id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES project.projects(id) ON DELETE RESTRICT)",
        )
        jdbc.update(
            "INSERT INTO project.protected_project_children (id, project_id) VALUES (?, ?)",
            UUID.randomUUID(),
            projectId,
        )

        assertFailsWith<ProjectDeleteRestricted> {
            service.permanentlyDelete(DeleteProjectCommand(owner, workspace, projectId, 0, "Protected"))
        }
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM project.projects WHERE id = ?", Int::class.java, projectId))
        assertEquals(
            1,
            jdbc.queryForObject("SELECT count(*) FROM project.project_memberships WHERE project_id = ?", Int::class.java, projectId),
        )
    }

    @Test
    fun `edit requires project owner and current version`() {
        val owner = fixtureUser("Owner")
        val member = fixtureUser("Member")
        val workspace = fixtureWorkspace(owner)
        fixtureWorkspaceMembership(workspace, member)
        val projectId = fixtureProject(workspace, owner, "Before", now)

        assertFailsWith<ProjectNotFound> {
            service.edit(EditProjectCommand(member, workspace, projectId, 0, "Denied", null))
        }
        val edited = service.edit(EditProjectCommand(owner, workspace, projectId, 0, " After ", " Updated "))
        assertEquals("After", edited.name)
        assertEquals("Updated", edited.description)
        assertEquals(1, edited.version)
        assertFailsWith<ProjectVersionConflict> {
            service.edit(EditProjectCommand(owner, workspace, projectId, 0, "Stale", null))
        }
        assertValidationPath("expectedVersion") {
            service.edit(EditProjectCommand(owner, workspace, projectId, -1, "Invalid", null))
        }
        assertEquals("After", service.detail(owner, workspace, projectId).name)
    }

    private fun assertValidationPath(
        path: String,
        action: () -> Unit,
    ) {
        assertEquals(path, assertFailsWith<ProjectValidationFailed> { action() }.path)
    }

    private fun createCommand(
        userId: UUID,
        workspaceId: UUID,
        requestId: UUID,
        name: String,
        description: String?,
    ) = CreateProjectCommand(userId, workspaceId, requestId, name, description)

    private fun fixtureUser(displayName: String): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO access.users (id, display_name, status, created_at) VALUES (?, ?, 'ACTIVE', ?)",
            id,
            displayName,
            now.atOffset(ZoneOffset.UTC),
        )
        return id
    }

    private fun fixtureWorkspace(owner: UUID): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO workspace.workspaces (id, type, personal_owner_user_id, created_at, updated_at) " +
                "VALUES (?, 'PERSONAL', ?, ?, ?)",
            id,
            owner,
            now.atOffset(ZoneOffset.UTC),
            now.atOffset(ZoneOffset.UTC),
        )
        fixtureWorkspaceMembership(id, owner)
        return id
    }

    private fun fixtureWorkspaceMembership(
        workspaceId: UUID,
        userId: UUID,
    ) {
        jdbc.update(
            "INSERT INTO workspace.workspace_memberships (id, workspace_id, user_id, role, created_at) " +
                "VALUES (?, ?, ?, 'OWNER', ?)",
            UUID.randomUUID(),
            workspaceId,
            userId,
            now.atOffset(ZoneOffset.UTC),
        )
    }

    private fun fixtureProject(
        workspaceId: UUID,
        ownerId: UUID,
        name: String,
        createdAt: Instant,
        id: UUID = UUID.randomUUID(),
    ): UUID =
        transactions.execute {
            jdbc.update(
                "INSERT INTO project.projects " +
                    "(id, workspace_id, name, description, status, version, created_by_user_id, create_request_id, " +
                    "create_request_fingerprint, created_at, updated_at, archived_at) " +
                    "VALUES (?, ?, ?, '', 'ACTIVE', 0, ?, ?, 'fixture', ?, ?, NULL)",
                id,
                workspaceId,
                name,
                ownerId,
                UUID.randomUUID(),
                createdAt.atOffset(ZoneOffset.UTC),
                createdAt.atOffset(ZoneOffset.UTC),
            )
            jdbc.update(
                "INSERT INTO project.project_memberships (id, project_id, user_id, role, created_at) " +
                    "VALUES (?, ?, ?, 'OWNER', ?)",
                UUID.randomUUID(),
                id,
                ownerId,
                createdAt.atOffset(ZoneOffset.UTC),
            )
            id
        }

    private class JdbcWorkspaceAccessQuery(
        dataSource: DataSource,
    ) : WorkspaceAccessQuery {
        private val jdbc = JdbcTemplate(dataSource)

        override fun roleFor(
            userId: UUID,
            workspaceId: UUID,
        ): WorkspaceRole? =
            jdbc
                .query(
                    "SELECT m.role FROM workspace.workspace_memberships m " +
                        "JOIN access.users u ON u.id = m.user_id AND u.status = 'ACTIVE' " +
                        "WHERE m.user_id = ? AND m.workspace_id = ?",
                    { rows, _ -> WorkspaceRole.valueOf(rows.getString("role")) },
                    userId,
                    workspaceId,
                ).singleOrNull()
    }
}
