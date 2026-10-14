package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.ExternalIdentityAlreadyExistsException
import ai.taskpilot.coreapi.access.model.ExternalIdentity
import ai.taskpilot.coreapi.access.model.ExternalIdentityId
import ai.taskpilot.coreapi.access.model.ExternalIdentityKey
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.persistence.JdbcFederatedIdentityStore
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.URI
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FederatedIdentityPersistenceIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer
    private lateinit var dataSource: DataSource
    private lateinit var jdbc: JdbcTemplate
    private lateinit var store: JdbcFederatedIdentityStore

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
        store = JdbcFederatedIdentityStore(dataSource)
    }

    @AfterAll
    fun stopPostgreSql() = postgres.stop()

    @BeforeEach
    fun reset() {
        jdbc.execute(
            "TRUNCATE TABLE access.terms_acceptances, access.external_identities, access.users CASCADE",
        )
    }

    @Test
    fun `identity triple is globally unique while one user may own multiple external identities`() {
        val userId = insertUser("Mona")
        val first = identity(userId, subject = "42")
        val second =
            identity(
                userId = userId,
                provider = "google",
                authority = "https://accounts.google.com",
                subject = "abc",
            )

        store.link(first)
        store.link(second)

        assertEquals(userId, store.findUserId(first.key))
        assertEquals(userId, store.findUserId(second.key))
        assertEquals(
            2,
            jdbc.queryForObject(
                "SELECT count(*) FROM access.external_identities WHERE user_id = ?",
                Int::class.java,
                userId.value,
            ),
        )
        val otherUserId = insertUser("Other")
        assertFailsWith<ExternalIdentityAlreadyExistsException> {
            store.link(identity(otherUserId, subject = "42"))
        }
    }

    @Test
    fun `profile resemblance never merges distinct durable provider subjects`() {
        val firstUser = insertUser("Same Name")
        val secondUser = insertUser("Same Name")
        val first = identity(firstUser, subject = "42")
        val second = identity(secondUser, subject = "43")

        store.link(first)
        store.link(second)

        assertNotEquals(firstUser, secondUser)
        assertEquals(firstUser, store.findUserId(first.key))
        assertEquals(secondUser, store.findUserId(second.key))
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM access.users", Int::class.java))
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM access.external_identities", Int::class.java))
        assertTrue(
            jdbc
                .queryForList(
                    "SELECT column_name FROM information_schema.columns " +
                        "WHERE table_schema = 'access' AND table_name = 'external_identities'",
                    String::class.java,
                ).none { it.orEmpty().contains("email") },
        )
    }

    private fun insertUser(displayName: String): UserId {
        val userId = UserId(UUID.randomUUID())
        jdbc.update(
            "INSERT INTO access.users (id, display_name, avatar_url, status, created_at) " +
                "VALUES (?, ?, NULL, 'ACTIVE', ?)",
            userId.value,
            displayName,
            Instant.parse("2026-10-06T00:00:00Z").atOffset(ZoneOffset.UTC),
        )
        return userId
    }

    private fun identity(
        userId: UserId,
        provider: String = "github",
        authority: String = "https://github.com",
        subject: String,
        now: Instant = Instant.parse("2026-10-06T00:00:00Z"),
    ) = ExternalIdentity(
        ExternalIdentityId(UUID.randomUUID()),
        userId,
        ExternalIdentityKey(provider, URI(authority), subject),
        now,
        now,
    )
}
