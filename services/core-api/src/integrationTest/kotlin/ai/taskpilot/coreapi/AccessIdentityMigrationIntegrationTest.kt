package ai.taskpilot.coreapi

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.testcontainers.postgresql.PostgreSQLContainer
import java.sql.DriverManager
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AccessIdentityMigrationIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer

    @BeforeAll
    fun startPostgreSql() {
        postgres = PostgreSQLContainer("postgres:17-alpine")
        postgres.start()
    }

    @AfterAll
    fun stopPostgreSql() {
        postgres.stop()
    }

    @Test
    fun `production migrations create the access security schema from an empty PostgreSQL database`() {
        val flyway =
            Flyway
                .configure()
                .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
                .locations("classpath:db/migration")
                .failOnMissingLocations(true)
                .load()

        assertEquals(listOf("1", "2", "3", "4", "5"), flyway.info().pending().map { it.version.version })
        assertEquals(5, flyway.migrate().migrationsExecuted)

        DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { connection ->
            val tables =
                connection
                    .prepareStatement(
                        """
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = 'public'
                        """.trimIndent(),
                    ).use { statement ->
                        statement.executeQuery().use { rows ->
                            buildSet {
                                while (rows.next()) add(rows.getString("table_name"))
                            }
                        }
                    }
            assertTrue(
                tables.containsAll(
                    setOf(
                        "app_users",
                        "email_identities",
                        "password_credentials",
                        "terms_acceptances",
                        "verification_challenges",
                        "auth_continuations",
                        "verification_rate_limits",
                        "user_sessions",
                        "refresh_recoveries",
                        "workspaces",
                        "workspace_memberships",
                        "workspace_creation_requests",
                        "projects",
                        "project_memberships",
                    ),
                ),
            )
        }
    }
}
