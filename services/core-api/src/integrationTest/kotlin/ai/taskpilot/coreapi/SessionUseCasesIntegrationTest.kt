package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.HmacSha256SecretDigester
import ai.taskpilot.coreapi.access.application.RefreshSessionCommand
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.SessionPolicy
import ai.taskpilot.coreapi.access.application.SessionTokenGenerator
import ai.taskpilot.coreapi.access.infrastructure.AesGcmSessionRecoveryCipher
import ai.taskpilot.coreapi.access.persistence.JdbcSessionUseCases
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.postgresql.PostgreSQLContainer
import java.nio.charset.StandardCharsets
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@Suppress("TooManyFunctions") // Scenario-rich PostgreSQL lifecycle fixture.
class SessionUseCasesIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer
    private lateinit var dataSource: DataSource
    private lateinit var jdbc: JdbcTemplate
    private val now = Instant.parse("2026-09-30T10:00:00Z")
    private val digester = HmacSha256SecretDigester(ByteArray(32) { 7 })
    private val cipher = AesGcmSessionRecoveryCipher(ByteArray(32) { 11 })

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
    }

    @BeforeEach
    fun clearTables() {
        jdbc.execute(
            """
            TRUNCATE project_memberships, projects, workspace_creation_requests, workspace_memberships, workspaces,
                     refresh_recoveries, user_sessions, auth_continuations, verification_challenges,
                     verification_rate_limits, terms_acceptances, password_credentials, email_identities, app_users
            """.trimIndent(),
        )
    }

    @AfterAll
    fun stopPostgreSql() = postgres.stop()

    @Test
    fun `refresh rotates digests and same request id recovers the exact encrypted result`() {
        val fixture = insertSession()
        val requestId = UUID.randomUUID()
        val useCases = newUseCases()

        val first =
            assertIs<RefreshSessionResult.Refreshed>(
                useCases.refresh(RefreshSessionCommand(fixture.refreshToken, requestId)),
            )
        val recovery =
            assertIs<RefreshSessionResult.Refreshed>(
                useCases.refresh(RefreshSessionCommand(fixture.refreshToken, requestId)),
            )

        assertEquals(first.session, recovery.session)
        assertNotEquals(fixture.accessToken, first.session.accessToken)
        assertNotEquals(fixture.refreshToken, first.session.refreshToken)
        assertEquals(2L, jdbc.queryForObject("SELECT generation FROM user_sessions", Long::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM refresh_recoveries", Int::class.java))
        val stored = jdbc.queryForObject("SELECT encrypted_result FROM refresh_recoveries", ByteArray::class.java)
        assertTrue(requireNotNull(stored).toString(Charsets.UTF_8).contains(first.session.refreshToken).not())
    }

    @Test
    fun `concurrent refresh with the same request id rotates once and returns one deterministic result`() {
        val fixture = insertSession()
        val requestId = UUID.randomUUID()
        val useCases = newUseCases()
        val results =
            concurrently(2) {
                useCases.refresh(RefreshSessionCommand(fixture.refreshToken, requestId))
            }.map { assertIs<RefreshSessionResult.Refreshed>(it).session }

        assertEquals(results.first(), results.last())
        assertEquals(2L, jdbc.queryForObject("SELECT generation FROM user_sessions", Long::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM refresh_recoveries", Int::class.java))
    }

    @Test
    fun `concurrent refresh with different request ids revokes the family`() {
        val fixture = insertSession()
        val useCases = newUseCases()
        val requestIds = listOf(UUID.randomUUID(), UUID.randomUUID())

        val results =
            concurrently(requestIds.size) { index ->
                useCases.refresh(RefreshSessionCommand(fixture.refreshToken, requestIds[index]))
            }

        assertEquals(1, results.count { it is RefreshSessionResult.Refreshed })
        assertEquals(1, results.count { it == RefreshSessionResult.AuthenticationRequired })
        assertEquals("REVOKED", jdbc.queryForObject("SELECT status FROM user_sessions", String::class.java))
        val issued = results.filterIsInstance<RefreshSessionResult.Refreshed>().single().session
        assertEquals(CurrentUserResult.AuthenticationRequired, useCases.currentUser(issued.accessToken))
    }

    @Test
    fun `different request id reusing rotated token revokes family`() {
        val fixture = insertSession()
        val useCases = newUseCases()
        val first =
            assertIs<RefreshSessionResult.Refreshed>(
                useCases.refresh(RefreshSessionCommand(fixture.refreshToken, UUID.randomUUID())),
            )

        assertEquals(
            RefreshSessionResult.AuthenticationRequired,
            useCases.refresh(RefreshSessionCommand(fixture.refreshToken, UUID.randomUUID())),
        )
        assertEquals(CurrentUserResult.AuthenticationRequired, useCases.currentUser(first.session.accessToken))
        assertEquals("REVOKED", jdbc.queryForObject("SELECT status FROM user_sessions", String::class.java))
    }

    @Test
    fun `expired recovery revokes family instead of returning ciphertext`() {
        val fixture = insertSession()
        val requestId = UUID.randomUUID()
        val useCases = newUseCases(recoveryWindow = Duration.ofSeconds(1))
        useCases.refresh(RefreshSessionCommand(fixture.refreshToken, requestId))
        val afterWindow = newUseCases(clock = Clock.fixed(now.plusSeconds(2), ZoneOffset.UTC))

        assertEquals(
            RefreshSessionResult.AuthenticationRequired,
            afterWindow.refresh(RefreshSessionCommand(fixture.refreshToken, requestId)),
        )
        assertEquals("REVOKED", jdbc.queryForObject("SELECT status FROM user_sessions", String::class.java))
    }

    @Test
    fun `valid access returns current user and idempotent logout revokes it`() {
        val fixture = insertSession()
        val useCases = newUseCases()

        val current = assertIs<CurrentUserResult.Authenticated>(useCases.currentUser(fixture.accessToken))
        assertEquals(fixture.userId, current.currentUser.userId.value)
        assertEquals("session@example.com", current.currentUser.email)

        useCases.logout(fixture.accessToken)
        useCases.logout(fixture.accessToken)

        assertEquals(CurrentUserResult.AuthenticationRequired, useCases.currentUser(fixture.accessToken))
        assertEquals("REVOKED", jdbc.queryForObject("SELECT status FROM user_sessions", String::class.java))
    }

    private fun newUseCases(
        recoveryWindow: Duration = Duration.ofMinutes(5),
        clock: Clock = Clock.fixed(now, ZoneOffset.UTC),
    ): JdbcSessionUseCases =
        JdbcSessionUseCases(
            dataSource = dataSource,
            secretDigester = digester,
            tokenGenerator = SessionTokenGenerator { "rotated-${UUID.randomUUID()}" },
            recoveryCipher = cipher,
            sessionPolicy = SessionPolicy(),
            recoveryWindow = recoveryWindow,
            clock = clock,
        )

    private fun <T> concurrently(
        count: Int,
        operation: (Int) -> T,
    ): List<T> {
        val ready = CountDownLatch(count)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(count)
        return try {
            val futures =
                (0 until count).map { index ->
                    executor.submit(
                        Callable {
                            ready.countDown()
                            check(start.await(10, TimeUnit.SECONDS))
                            operation(index)
                        },
                    )
                }
            check(ready.await(10, TimeUnit.SECONDS))
            start.countDown()
            futures.map { it.get(20, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }
    }

    private fun insertSession(): SessionFixture {
        val userId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        val accessToken = "access-${UUID.randomUUID()}"
        val refreshToken = "refresh-${UUID.randomUUID()}"
        jdbc.update(
            "INSERT INTO app_users (user_id, display_name, status, created_at) VALUES (?, 'Session User', 'ACTIVE', ?)",
            userId,
            now.minusSeconds(60).atOffset(ZoneOffset.UTC),
        )
        jdbc.update(
            """
            INSERT INTO email_identities (
                email_identity_id, user_id, normalized_email, display_email, verified_at, created_at
            ) VALUES (?, ?, 'session@example.com', 'session@example.com', ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            userId,
            now.minusSeconds(60).atOffset(ZoneOffset.UTC),
            now.minusSeconds(60).atOffset(ZoneOffset.UTC),
        )
        jdbc.update(
            """
            INSERT INTO user_sessions (
                session_id, family_id, user_id, access_token_digest, access_expires_at,
                refresh_token_digest, refresh_expires_at, absolute_expires_at,
                generation, status, created_at, last_refreshed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?)
            """.trimIndent(),
            sessionId,
            UUID.randomUUID(),
            userId,
            digest("session:access", accessToken),
            now.plusSeconds(900).atOffset(ZoneOffset.UTC),
            digest("session:refresh", refreshToken),
            now.plus(Duration.ofDays(30)).atOffset(ZoneOffset.UTC),
            now.plus(Duration.ofDays(90)).atOffset(ZoneOffset.UTC),
            now.minusSeconds(60).atOffset(ZoneOffset.UTC),
            now.minusSeconds(60).atOffset(ZoneOffset.UTC),
        )
        return SessionFixture(userId, accessToken, refreshToken)
    }

    private fun digest(
        namespace: String,
        secret: String,
    ): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(ByteArray(32) { 7 }, "HmacSHA256"))
        val value = "$namespace\u0000$secret".toByteArray(StandardCharsets.UTF_8)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(value))
    }

    private data class SessionFixture(
        val userId: UUID,
        val accessToken: String,
        val refreshToken: String,
    )
}
