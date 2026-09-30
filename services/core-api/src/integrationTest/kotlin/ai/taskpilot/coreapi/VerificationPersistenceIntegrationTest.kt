package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.ChallengeDeliveryState
import ai.taskpilot.coreapi.access.application.ChallengeIssueResult
import ai.taskpilot.coreapi.access.application.ChallengeVerificationResult
import ai.taskpilot.coreapi.access.application.ConsumeContinuationCommand
import ai.taskpilot.coreapi.access.application.ContinuationConsumptionResult
import ai.taskpilot.coreapi.access.application.HmacSha256SecretDigester
import ai.taskpilot.coreapi.access.application.NewAuthContinuation
import ai.taskpilot.coreapi.access.application.NewVerificationChallenge
import ai.taskpilot.coreapi.access.application.RateLimitAction
import ai.taskpilot.coreapi.access.application.RateLimitDecision
import ai.taskpilot.coreapi.access.application.VerificationRateLimiter
import ai.taskpilot.coreapi.access.application.VerificationRequestSignals
import ai.taskpilot.coreapi.access.application.VerifyChallengeCommand
import ai.taskpilot.coreapi.access.model.AuthContinuationId
import ai.taskpilot.coreapi.access.model.SecretDigest
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.VerificationChallengeId
import ai.taskpilot.coreapi.access.model.VerificationPurpose
import ai.taskpilot.coreapi.access.model.VerificationSubject
import ai.taskpilot.coreapi.access.persistence.JdbcRateLimitStore
import ai.taskpilot.coreapi.access.persistence.JdbcVerificationStore
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.postgresql.PostgreSQLContainer
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class ChallengeVerificationPersistenceIntegrationTest : PostgreSqlVerificationFixture() {
    @Test
    fun `resend cooldown is shared and a later challenge invalidates the previous code`() {
        val first = challenge()
        assertIs<ChallengeIssueResult.Created>(store.issue(first))
        store.recordDelivery(first.challengeId, ChallengeDeliveryState.SENT, NOW)

        val cooling = assertIs<ChallengeIssueResult.CoolingDown>(store.issue(challenge(now = NOW.plusSeconds(30))))
        assertEquals(first.challengeId, cooling.challengeId)
        assertEquals(Duration.ofSeconds(30), cooling.retryAfter)

        val replacement = challenge(now = NOW.plusSeconds(61))
        assertIs<ChallengeIssueResult.Created>(store.issue(replacement))
        store.recordDelivery(replacement.challengeId, ChallengeDeliveryState.SENT, NOW.plusSeconds(61))

        assertIs<ChallengeVerificationResult.InvalidOrExpired>(store.verify(verify(first, NOW.plusSeconds(62))))
        assertIs<ChallengeVerificationResult.Verified>(store.verify(verify(replacement, NOW.plusSeconds(62))))
    }

    @Test
    fun `concurrent issue enforces one shared resend cooldown winner`() {
        val candidates = listOf(challenge(), challenge())

        val results = concurrently(candidates.map { candidate -> Callable { store.issue(candidate) } })

        assertEquals(1, results.count { it is ChallengeIssueResult.Created })
        assertEquals(1, results.count { it is ChallengeIssueResult.CoolingDown })
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM verification_challenges", Int::class.java))
    }

    @Test
    fun `only sent or outcome unknown challenges can be verified`() {
        val rejectedStates =
            listOf(
                ChallengeDeliveryState.FAILED,
                ChallengeDeliveryState.SUPPRESSED,
            )
        rejectedStates.forEachIndexed { index, state ->
            val email = "rejected-$index@example.com"
            val issued = challenge(subject = VerificationSubject(email, null))
            assertIs<ChallengeIssueResult.Created>(store.issue(issued))
            store.recordDelivery(issued.challengeId, state, NOW)
            assertIs<ChallengeVerificationResult.InvalidOrExpired>(
                store.verify(verify(issued, NOW.plusSeconds(1), email = email)),
            )
        }

        val unknownEmail = "unknown-outcome@example.com"
        val unknown = challenge(subject = VerificationSubject(unknownEmail, null))
        assertIs<ChallengeIssueResult.Created>(store.issue(unknown))
        store.recordDelivery(unknown.challengeId, ChallengeDeliveryState.OUTCOME_UNKNOWN, NOW)
        assertIs<ChallengeVerificationResult.Verified>(
            store.verify(verify(unknown, NOW.plusSeconds(1), email = unknownEmail)),
        )
    }

    @Test
    fun `purpose subject expiry and maximum attempts are enforced without consuming another challenge`() {
        val issued = challenge()
        assertIs<ChallengeIssueResult.Created>(store.issue(issued))
        store.recordDelivery(issued.challengeId, ChallengeDeliveryState.SENT, NOW)

        assertIs<ChallengeVerificationResult.InvalidOrExpired>(
            store.verify(verify(issued, NOW.plusSeconds(1), purpose = VerificationPurpose.PASSWORD_RESET)),
        )
        assertIs<ChallengeVerificationResult.InvalidOrExpired>(
            store.verify(verify(issued, NOW.plusSeconds(1), email = "another@example.com")),
        )
        repeat(issued.maximumAttempts - 1) { attempt ->
            assertIs<ChallengeVerificationResult.InvalidOrExpired>(
                store.verify(verify(issued, NOW.plusSeconds(2L + attempt), digest = digest("wrong"))),
            )
        }
        assertIs<ChallengeVerificationResult.TooManyAttempts>(
            store.verify(verify(issued, NOW.plusSeconds(7), digest = digest("wrong"))),
        )
        assertIs<ChallengeVerificationResult.TooManyAttempts>(store.verify(verify(issued, NOW.plusSeconds(8))))

        val expiredEmail = "expired@example.com"
        val expired =
            challenge(
                now = NOW.minusSeconds(601),
                subject = VerificationSubject(expiredEmail, null),
            )
        assertIs<ChallengeIssueResult.Created>(store.issue(expired))
        store.recordDelivery(expired.challengeId, ChallengeDeliveryState.SENT, NOW.minusSeconds(601))
        assertIs<ChallengeVerificationResult.InvalidOrExpired>(
            store.verify(verify(expired, NOW, email = expiredEmail)),
        )
    }

    @Test
    fun `concurrent challenge verification consumes once and creates one continuation bound to stored subject`() {
        val userId = UserId(UUID.randomUUID())
        insertUser(userId)
        val issued = challenge(subject = VerificationSubject(EMAIL, userId))
        store.issue(issued)
        store.recordDelivery(issued.challengeId, ChallengeDeliveryState.SENT, NOW)
        val commands = listOf(continuationVerify(issued), continuationVerify(issued))

        val results = concurrently(commands.map { Callable { store.verify(it) } })

        assertEquals(1, results.count { it is ChallengeVerificationResult.Verified })
        assertEquals(1, results.count { it is ChallengeVerificationResult.InvalidOrExpired })
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM auth_continuations", Int::class.java))
        assertEquals(userId.value, jdbc.queryForObject("SELECT user_id FROM auth_continuations", UUID::class.java))
    }

    @Test
    fun `continuation persists only digest and concurrent consumption succeeds once`() {
        val issued = challenge(purpose = VerificationPurpose.PASSWORD_RESET)
        store.issue(issued)
        store.recordDelivery(issued.challengeId, ChallengeDeliveryState.SENT, NOW)
        val secret = "continuation-secret-value"
        val continuationId = AuthContinuationId(UUID.randomUUID())
        val verifyCommand = continuationVerify(issued, continuationId, secret)
        assertIs<ChallengeVerificationResult.Verified>(store.verify(verifyCommand))

        val stored =
            requireNotNull(
                jdbc.queryForObject("SELECT secret_digest FROM auth_continuations", String::class.java),
            )
        assertNotEquals(secret, stored)
        assertTrue(!stored.contains(secret))
        val consume =
            ConsumeContinuationCommand(
                continuationId,
                issued.purpose,
                EMAIL,
                digest(secret, "continuation:${issued.purpose.name}:${continuationId.value}"),
                NOW.plusSeconds(2),
            )

        val results =
            concurrently(
                listOf(
                    Callable { store.consumeContinuation(consume) },
                    Callable { store.consumeContinuation(consume) },
                ),
            )

        assertEquals(1, results.count { it is ContinuationConsumptionResult.Consumed })
        assertEquals(1, results.count { it is ContinuationConsumptionResult.InvalidOrExpired })
    }

    @Test
    fun `continuation mismatch does not consume it`() {
        val issued = challenge(purpose = VerificationPurpose.PASSWORD_RESET)
        assertIs<ChallengeIssueResult.Created>(store.issue(issued))
        store.recordDelivery(issued.challengeId, ChallengeDeliveryState.SENT, NOW)
        val secret = "continuation-secret-value"
        val continuationId = AuthContinuationId(UUID.randomUUID())
        assertIs<ChallengeVerificationResult.Verified>(
            store.verify(continuationVerify(issued, continuationId, secret)),
        )

        fun consume(
            purpose: VerificationPurpose = VerificationPurpose.PASSWORD_RESET,
            email: String = EMAIL,
            presentedSecret: String = secret,
            now: Instant = NOW.plusSeconds(2),
        ) = ConsumeContinuationCommand(
            continuationId,
            purpose,
            email,
            digest(presentedSecret, "continuation:${purpose.name}:${continuationId.value}"),
            now,
        )

        assertIs<ContinuationConsumptionResult.InvalidOrExpired>(
            store.consumeContinuation(consume(purpose = VerificationPurpose.REGISTER_EMAIL_VERIFY)),
        )
        assertIs<ContinuationConsumptionResult.InvalidOrExpired>(
            store.consumeContinuation(consume(email = "another@example.com")),
        )
        assertIs<ContinuationConsumptionResult.InvalidOrExpired>(
            store.consumeContinuation(consume(presentedSecret = "wrong-secret")),
        )
        assertIs<ContinuationConsumptionResult.Consumed>(store.consumeContinuation(consume()))
    }

    @Test
    fun `expired continuation fails closed`() {
        val expiredEmail = "expired-continuation@example.com"
        val expiredChallenge =
            challenge(
                now = NOW.minusSeconds(601),
                purpose = VerificationPurpose.PASSWORD_RESET,
                subject = VerificationSubject(expiredEmail, null),
            )
        assertIs<ChallengeIssueResult.Created>(store.issue(expiredChallenge))
        store.recordDelivery(expiredChallenge.challengeId, ChallengeDeliveryState.SENT, NOW.minusSeconds(601))
        val expiredId = AuthContinuationId(UUID.randomUUID())
        val expiredSecret = "expired-continuation-secret"
        val expiredVerify =
            VerifyChallengeCommand(
                expiredChallenge.challengeId,
                VerificationPurpose.PASSWORD_RESET,
                expiredEmail,
                expiredChallenge.codeDigest,
                NOW.minusSeconds(600),
                NewAuthContinuation(
                    expiredId,
                    VerificationPurpose.PASSWORD_RESET,
                    expiredChallenge.challengeId,
                    digest(
                        expiredSecret,
                        "continuation:${VerificationPurpose.PASSWORD_RESET.name}:${expiredId.value}",
                    ),
                    NOW.minusSeconds(600),
                    NOW,
                ),
            )
        assertIs<ChallengeVerificationResult.Verified>(store.verify(expiredVerify))
        assertIs<ContinuationConsumptionResult.InvalidOrExpired>(
            store.consumeContinuation(
                ConsumeContinuationCommand(
                    expiredId,
                    VerificationPurpose.PASSWORD_RESET,
                    expiredEmail,
                    digest(
                        expiredSecret,
                        "continuation:${VerificationPurpose.PASSWORD_RESET.name}:${expiredId.value}",
                    ),
                    NOW,
                ),
            ),
        )
    }
}

class RateLimitVerificationPersistenceIntegrationTest : PostgreSqlVerificationFixture() {
    @Test
    fun `rate limit survives new store instances and applies equivalent email network and device buckets`() {
        val signals = VerificationRequestSignals("203.0.113.0/24", "installation-a")
        val firstLimiter = VerificationRateLimiter(JdbcRateLimitStore(dataSource), digester, 2, Duration.ofMinutes(15))
        val secondLimiter = VerificationRateLimiter(JdbcRateLimitStore(dataSource), digester, 2, Duration.ofMinutes(15))

        assertIs<RateLimitDecision.Allowed>(
            firstLimiter.acquire(RateLimitAction.REQUEST_CODE, PURPOSE, EMAIL, signals, NOW),
        )
        assertIs<RateLimitDecision.Allowed>(
            secondLimiter.acquire(RateLimitAction.REQUEST_CODE, PURPOSE, EMAIL, signals, NOW.plusSeconds(1)),
        )
        val rejected =
            assertIs<RateLimitDecision.Rejected>(
                secondLimiter.acquire(
                    RateLimitAction.REQUEST_CODE,
                    PURPOSE,
                    "unknown@example.com",
                    signals,
                    NOW.plusSeconds(2),
                ),
            )

        assertEquals(Duration.ofSeconds(898), rejected.retryAfter)
        assertEquals(3, jdbc.queryForObject("SELECT count(*) FROM verification_rate_limits", Int::class.java))
        val rawKeys =
            jdbc
                .queryForList("SELECT protected_key FROM verification_rate_limits", String::class.java)
                .map(::requireNotNull)
        assertTrue(
            rawKeys.none {
                it.contains(EMAIL) ||
                    it.contains(signals.sourceNetwork) ||
                    it.contains(signals.deviceInstallationId)
            },
        )
    }

    @Test
    fun `rate limit resets after its window and concurrent requests never exceed the threshold`() {
        val limiter = VerificationRateLimiter(JdbcRateLimitStore(dataSource), digester, 2, Duration.ofMinutes(15))
        val signals = VerificationRequestSignals("198.51.100.0/24", "installation-concurrent")

        val concurrent =
            concurrently(
                List(8) {
                    Callable {
                        limiter.acquire(RateLimitAction.VERIFY_CODE, PURPOSE, EMAIL, signals, NOW)
                    }
                },
            )

        assertEquals(2, concurrent.count { it is RateLimitDecision.Allowed })
        assertEquals(6, concurrent.count { it is RateLimitDecision.Rejected })
        assertEquals(
            setOf(2),
            jdbc
                .queryForList("SELECT attempt_count FROM verification_rate_limits", Int::class.java)
                .map(::requireNotNull)
                .toSet(),
        )
        assertIs<RateLimitDecision.Allowed>(
            limiter.acquire(RateLimitAction.VERIFY_CODE, PURPOSE, EMAIL, signals, NOW.plusSeconds(900)),
        )
    }
}

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
abstract class PostgreSqlVerificationFixture {
    private lateinit var postgres: PostgreSQLContainer
    protected lateinit var dataSource: DataSource
    protected lateinit var jdbc: JdbcTemplate
    protected lateinit var store: JdbcVerificationStore
    protected val digester = HmacSha256SecretDigester(ByteArray(32) { 9 })

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
        store = JdbcVerificationStore(dataSource)
    }

    @BeforeEach
    fun clearVerificationTables() {
        jdbc.execute("TRUNCATE auth_continuations, verification_challenges, verification_rate_limits")
    }

    @AfterAll
    fun stopPostgreSql() {
        postgres.stop()
    }

    protected fun challenge(
        now: Instant = NOW,
        purpose: VerificationPurpose = PURPOSE,
        subject: VerificationSubject = VerificationSubject(EMAIL, null),
    ): NewVerificationChallenge {
        val id = VerificationChallengeId(UUID.randomUUID())
        return NewVerificationChallenge(
            challengeId = id,
            purpose = purpose,
            subject = subject,
            codeDigest = digest(CODE, "otp:${purpose.name}:${id.value}"),
            createdAt = now,
            expiresAt = now.plusSeconds(600),
            resendAvailableAt = now.plusSeconds(60),
            maximumAttempts = 5,
        )
    }

    protected fun verify(
        challenge: NewVerificationChallenge,
        now: Instant,
        purpose: VerificationPurpose = challenge.purpose,
        email: String = EMAIL,
        digest: SecretDigest = challenge.codeDigest,
    ) = VerifyChallengeCommand(challenge.challengeId, purpose, email, digest, now, null)

    protected fun continuationVerify(
        challenge: NewVerificationChallenge,
        continuationId: AuthContinuationId = AuthContinuationId(UUID.randomUUID()),
        secret: String = "continuation-secret-value",
    ): VerifyChallengeCommand =
        VerifyChallengeCommand(
            challenge.challengeId,
            challenge.purpose,
            EMAIL,
            challenge.codeDigest,
            NOW.plusSeconds(1),
            NewAuthContinuation(
                continuationId,
                challenge.purpose,
                challenge.challengeId,
                digest(secret, "continuation:${challenge.purpose.name}:${continuationId.value}"),
                NOW.plusSeconds(1),
                NOW.plusSeconds(601),
            ),
        )

    protected fun digest(
        value: String,
        namespace: String = "test",
    ): SecretDigest = digester.digest(namespace, value)

    protected fun insertUser(userId: UserId) {
        jdbc.update(
            "INSERT INTO app_users (user_id, display_name, status, created_at) VALUES (?, ?, 'ACTIVE', ?)",
            userId.value,
            "Person",
            NOW.atOffset(java.time.ZoneOffset.UTC),
        )
    }

    protected fun <T> concurrently(commands: List<Callable<T>>): List<T> {
        val executor = Executors.newFixedThreadPool(commands.size)
        return try {
            executor.invokeAll(commands).map { it.get(10, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }
    }
}

private val NOW: Instant = Instant.parse("2026-09-30T10:00:00Z")
private const val EMAIL = "person@example.com"
private const val CODE = "123456"
private val PURPOSE = VerificationPurpose.REGISTER_EMAIL_VERIFY
