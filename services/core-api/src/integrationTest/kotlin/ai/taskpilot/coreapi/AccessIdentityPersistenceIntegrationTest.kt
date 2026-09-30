package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.EmailAddressNormalizer
import ai.taskpilot.coreapi.access.application.EmailIdentityAlreadyExistsException
import ai.taskpilot.coreapi.access.model.EmailIdentity
import ai.taskpilot.coreapi.access.model.EmailIdentityId
import ai.taskpilot.coreapi.access.model.NewAccessIdentity
import ai.taskpilot.coreapi.access.model.PasswordCredential
import ai.taskpilot.coreapi.access.model.PasswordDigest
import ai.taskpilot.coreapi.access.model.TermsAcceptance
import ai.taskpilot.coreapi.access.model.UserAccount
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.UserStatus
import ai.taskpilot.coreapi.access.persistence.JdbcAccessIdentityStore
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
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertIs

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AccessIdentityPersistenceIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer
    private lateinit var dataSource: DataSource
    private lateinit var jdbc: JdbcTemplate
    private lateinit var store: JdbcAccessIdentityStore

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
        store = JdbcAccessIdentityStore(dataSource)
    }

    @BeforeEach
    fun clearIdentityTables() {
        jdbc.execute(
            """
            TRUNCATE project_memberships, projects, workspace_creation_requests, workspace_memberships, workspaces,
                     refresh_recoveries, user_sessions, auth_continuations, verification_challenges,
                     verification_rate_limits, terms_acceptances, password_credentials, email_identities, app_users
            """.trimIndent(),
        )
    }

    @AfterAll
    fun stopPostgreSql() {
        postgres.stop()
    }

    @Test
    fun `persists the caller-assigned stable UserId and all identity facts atomically`() {
        val identity = identity(normalizedEmail = "owner@example.com")

        assertEquals(identity.user.userId, store.create(identity))
        assertEquals(identity.user.userId.value, userIdFor("owner@example.com"))
        assertCounts(users = 1, identities = 1, credentials = 1, terms = 1)
    }

    @Test
    fun `database unique key rejects a second equivalent normalized email without replacing the original UserId`() {
        val original = identity(normalizedEmail = "strasse@xn--bcher-kva.example")
        val duplicate = identity(normalizedEmail = "strasse@xn--bcher-kva.example")
        store.create(original)

        val failure = assertFails { store.create(duplicate) }

        assertIs<EmailIdentityAlreadyExistsException>(failure)
        assertEquals(original.user.userId.value, userIdFor(original.emailIdentity.email.normalized))
        assertCounts(users = 1, identities = 1, credentials = 1, terms = 1)
    }

    @Test
    fun `concurrent registration for one normalized email commits at most one complete identity`() {
        val first = identity(normalizedEmail = "race@example.com")
        val second = identity(normalizedEmail = "race@example.com")
        val executor = Executors.newFixedThreadPool(2)
        try {
            val results =
                executor
                    .invokeAll(
                        listOf(first, second).map { candidate ->
                            Callable { runCatching { store.create(candidate) } }
                        },
                    ).map { it.get(10, TimeUnit.SECONDS) }

            assertEquals(1, results.count(Result<UserId>::isSuccess))
            assertEquals(1, results.count { it.exceptionOrNull() is EmailIdentityAlreadyExistsException })
            assertCounts(users = 1, identities = 1, credentials = 1, terms = 1)
            val committedUserId = userIdFor("race@example.com")
            assertEquals(results.single { it.isSuccess }.getOrThrow().value, committedUserId)
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `credential constraint failure rolls back user and email identity`() {
        val invalid = identity(passwordDigest = "not-an-argon2id-digest")

        assertFails { store.create(invalid) }

        assertCounts(users = 0, identities = 0, credentials = 0, terms = 0)
    }

    @Test
    fun `terms constraint failure rolls back all earlier writes`() {
        val invalid = identity(termsVersion = " ")

        assertFails { store.create(invalid) }

        assertCounts(users = 0, identities = 0, credentials = 0, terms = 0)
    }

    private fun userIdFor(normalizedEmail: String): UUID =
        requireNotNull(
            jdbc.queryForObject(
                "SELECT user_id FROM email_identities WHERE normalized_email = ?",
                UUID::class.java,
                normalizedEmail,
            ),
        )

    private fun assertCounts(
        users: Int,
        identities: Int,
        credentials: Int,
        terms: Int,
    ) {
        assertEquals(users, jdbc.queryForObject("SELECT count(*) FROM app_users", Int::class.java))
        assertEquals(identities, jdbc.queryForObject("SELECT count(*) FROM email_identities", Int::class.java))
        assertEquals(credentials, jdbc.queryForObject("SELECT count(*) FROM password_credentials", Int::class.java))
        assertEquals(terms, jdbc.queryForObject("SELECT count(*) FROM terms_acceptances", Int::class.java))
    }
}

private fun identity(
    normalizedEmail: String = "person@example.com",
    passwordDigest: String = "\$argon2id\$v=19\$m=19456,t=2,p=1\$c2FsdA\$aGFzaA",
    termsVersion: String = "2026-09",
): NewAccessIdentity {
    val userId = UserId(UUID.randomUUID())
    val now = Instant.parse("2026-09-30T00:00:00Z")
    return NewAccessIdentity(
        user = UserAccount(userId, "Task Pilot", UserStatus.ACTIVE, now),
        emailIdentity =
            EmailIdentity(
                EmailIdentityId(UUID.randomUUID()),
                userId,
                EmailAddressNormalizer().normalize(normalizedEmail),
                now,
                now,
            ),
        passwordCredential = PasswordCredential(userId, PasswordDigest.fromEncoded(passwordDigest), now),
        termsAcceptance = TermsAcceptance(userId, termsVersion, now),
    )
}
