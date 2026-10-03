package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.CreateWorkspaceResult
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.Workspace
import ai.taskpilot.coreapi.access.model.WorkspaceId
import ai.taskpilot.coreapi.access.model.WorkspaceType
import ai.taskpilot.coreapi.access.persistence.JdbcWorkspaceStore
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
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertIs

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WorkspacePersistenceIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer
    private lateinit var dataSource: DataSource
    private lateinit var jdbc: JdbcTemplate
    private lateinit var store: JdbcWorkspaceStore
    private lateinit var actorValue: UUID
    private val actor: UserId get() = UserId(actorValue)

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
        store = JdbcWorkspaceStore(dataSource)
    }

    @AfterAll fun stop() = postgres.stop()

    @BeforeEach
    fun reset() {
        jdbc.execute(
            """
            TRUNCATE project_memberships, projects, workspace_creation_requests, workspace_memberships, workspaces,
                     refresh_recoveries, user_sessions, auth_continuations,
                     verification_challenges, verification_rate_limits,
                     terms_acceptances, password_credentials, email_identities, app_users
            """.trimIndent(),
        )
        actorValue = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO app_users(user_id, display_name, status, created_at) VALUES (?, 'Owner', 'ACTIVE', ?)",
            actor.value,
            OffsetDateTime.ofInstant(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC),
        )
    }

    @Test
    fun `workspace membership and completed request commit atomically and list is authoritative`() {
        val workspace = workspace("Platform")
        assertIs<CreateWorkspaceResult.Created>(store.create(actor, "key-1", workspace))
        assertEquals(listOf(workspace), store.listAccessible(actor))
        assertEquals(1, count("workspaces"))
        assertEquals(1, count("workspace_memberships"))
        assertEquals(1, count("workspace_creation_requests"))
    }

    @Test
    fun `membership failure rolls back workspace and idempotency result`() {
        val missingActor = UserId(UUID.randomUUID())
        assertFails { store.create(missingActor, "rollback-key", workspace("Rollback")) }
        assertEquals(0, count("workspaces"))
        assertEquals(0, count("workspace_memberships"))
        assertEquals(0, count("workspace_creation_requests"))
    }

    @Test
    fun `same actor key and payload replays while mismatch conflicts and same names with different keys are allowed`() {
        val first = workspace("Same")
        assertIs<CreateWorkspaceResult.Created>(store.create(actor, "stable-key", first))
        val replay = assertIs<CreateWorkspaceResult.Replayed>(store.create(actor, "stable-key", workspace("Same")))
        assertEquals(first.workspaceId, replay.workspace.workspaceId)
        assertEquals(
            CreateWorkspaceResult.IdempotencyConflict,
            store.create(actor, "stable-key", workspace("Different")),
        )
        assertIs<CreateWorkspaceResult.Created>(store.create(actor, "different-key", workspace("Same")))
        assertEquals(2, count("workspaces"))
    }

    @Test
    fun `concurrent same key commits at most one workspace and both observe its stable id`() {
        val executor = Executors.newFixedThreadPool(2)
        try {
            val results =
                executor
                    .invokeAll(
                        (1..2).map { index ->
                            Callable {
                                store.create(
                                    actor,
                                    "concurrent",
                                    workspace("Concurrent-$index").copy(name = "Concurrent"),
                                )
                            }
                        },
                    ).map { it.get() }
            val ids =
                results.map { result ->
                    when (result) {
                        is CreateWorkspaceResult.Created -> result.workspace.workspaceId
                        is CreateWorkspaceResult.Replayed -> result.workspace.workspaceId
                        else -> error("unexpected $result")
                    }
                }
            assertEquals(1, ids.distinct().size)
            assertEquals(1, count("workspaces"))
        } finally {
            executor.shutdownNow()
        }
    }

    private fun workspace(name: String) = Workspace(WorkspaceId(UUID.randomUUID()), name, WorkspaceType.ORGANIZATION)

    private fun count(table: String) = jdbc.queryForObject("SELECT count(*) FROM $table", Int::class.java)
}
