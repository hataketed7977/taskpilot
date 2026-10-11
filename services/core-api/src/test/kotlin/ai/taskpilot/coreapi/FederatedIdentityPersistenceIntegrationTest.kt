package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.ExternalIdentityAlreadyExistsException
import ai.taskpilot.coreapi.access.model.ExternalIdentity
import ai.taskpilot.coreapi.access.model.ExternalIdentityId
import ai.taskpilot.coreapi.access.model.ExternalIdentityKey
import ai.taskpilot.coreapi.access.model.NewFederatedUser
import ai.taskpilot.coreapi.access.model.TermsAcceptance
import ai.taskpilot.coreapi.access.model.TermsAcceptanceId
import ai.taskpilot.coreapi.access.model.UserAccount
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.UserStatus
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
        val first = registration(subject = "42", displayName = "Mona")
        val userId = store.register(first)
        val second =
            identity(
                userId = userId,
                provider = "google",
                authority = "https://accounts.google.com",
                subject = "abc",
            )

        store.link(second)

        assertEquals(userId, store.findUserId(first.externalIdentity.key))
        assertEquals(userId, store.findUserId(second.key))
        assertEquals(
            2,
            jdbc.queryForObject(
                "SELECT count(*) FROM access.external_identities WHERE user_id = ?",
                Int::class.java,
                userId.value,
            ),
        )
        assertFailsWith<ExternalIdentityAlreadyExistsException> {
            store.link(identity(UserId(UUID.randomUUID()), subject = "42"))
        }
    }

    @Test
    fun `profile resemblance never merges distinct durable provider subjects`() {
        val first = registration(subject = "42", displayName = "Same Name")
        val second = registration(subject = "43", displayName = "Same Name")

        val firstUser = store.register(first)
        val secondUser = store.register(second)

        assertNotEquals(firstUser, secondUser)
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

    @Test
    fun `concurrent first registration creates at most one user and no orphan records`() {
        val start = java.util.concurrent.CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val attempts =
                (1..2).map { index ->
                    pool.submit(
                        Callable {
                            start.await(5, TimeUnit.SECONDS)
                            runCatching { store.register(registration(subject = "99", displayName = "User $index")) }
                        },
                    )
                }
            start.countDown()
            val results = attempts.map { it.get(10, TimeUnit.SECONDS) }

            assertEquals(1, results.count { it.isSuccess })
            assertEquals(1, results.count { it.exceptionOrNull() is ExternalIdentityAlreadyExistsException })
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM access.users", Int::class.java))
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM access.external_identities", Int::class.java))
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM access.terms_acceptances", Int::class.java))
        } finally {
            pool.shutdownNow()
        }
    }

    private fun registration(
        subject: String,
        displayName: String,
    ): NewFederatedUser {
        val userId = UserId(UUID.randomUUID())
        val now = Instant.parse("2026-10-06T00:00:00Z")
        return NewFederatedUser(
            UserAccount(userId, displayName, UserStatus.ACTIVE, now, null),
            identity(userId, subject = subject, now = now),
            TermsAcceptance(
                TermsAcceptanceId(UUID.randomUUID()),
                userId,
                "2026-10",
                "terms-2026-10",
                "privacy-2026-10",
                "zh-CN",
                now,
            ),
        )
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
