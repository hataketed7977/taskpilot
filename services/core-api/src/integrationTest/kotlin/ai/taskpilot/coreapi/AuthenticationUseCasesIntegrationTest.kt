package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.Argon2idParameters
import ai.taskpilot.coreapi.access.application.Argon2idPasswordHasher
import ai.taskpilot.coreapi.access.application.AuthenticationResult
import ai.taskpilot.coreapi.access.application.EmailAddressNormalizer
import ai.taskpilot.coreapi.access.application.EmailCodeLoginCommand
import ai.taskpilot.coreapi.access.application.HmacSha256SecretDigester
import ai.taskpilot.coreapi.access.application.PasswordLoginCommand
import ai.taskpilot.coreapi.access.application.PasswordPolicy
import ai.taskpilot.coreapi.access.application.PasswordResetCommand
import ai.taskpilot.coreapi.access.application.PasswordResetResult
import ai.taskpilot.coreapi.access.application.RegistrationCommand
import ai.taskpilot.coreapi.access.application.RegistrationResult
import ai.taskpilot.coreapi.access.application.SessionPolicy
import ai.taskpilot.coreapi.access.application.SessionTokenGenerator
import ai.taskpilot.coreapi.access.model.AuthContinuationId
import ai.taskpilot.coreapi.access.model.ContinuationSecret
import ai.taskpilot.coreapi.access.model.VerificationChallengeId
import ai.taskpilot.coreapi.access.model.VerificationCode
import ai.taskpilot.coreapi.access.model.VerificationPurpose
import ai.taskpilot.coreapi.access.persistence.JdbcAuthenticationUseCases
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
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@Suppress("TooManyFunctions", "MaxLineLength") // Atomic scenarios share one PostgreSQL fixture.
class AuthenticationUseCasesIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer
    private lateinit var dataSource: DataSource
    private lateinit var jdbc: JdbcTemplate
    private val now = Instant.parse("2026-09-30T08:00:00Z")
    private val pepper = ByteArray(32) { index -> (index + 1).toByte() }
    private val passwordHasher =
        Argon2idPasswordHasher(Argon2idParameters(16, 32, parallelism = 1, memoryKiB = 4_096, iterations = 2))
    private val normalizer = EmailAddressNormalizer()

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
    fun `registration atomically consumes continuation and creates identity terms and first session`() {
        val proof = registrationProof("owner@example.com")
        val useCases = newUseCases()

        val result = useCases.register(registrationCommand(proof))

        val registered = assertIs<RegistrationResult.Registered>(result)
        assertEquals("owner@example.com", registered.session.currentUser.email)
        assertEquals(1, count("app_users"))
        assertEquals(1, count("email_identities"))
        assertEquals(1, count("password_credentials"))
        assertEquals(1, count("terms_acceptances"))
        assertEquals(1, count("user_sessions"))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM auth_continuations WHERE consumed_at IS NOT NULL", Int::class.java))
        val storedAccessDigest = jdbc.queryForObject("SELECT access_token_digest FROM user_sessions", String::class.java)
        val storedRefreshDigest = jdbc.queryForObject("SELECT refresh_token_digest FROM user_sessions", String::class.java)
        assertNotEquals(registered.session.accessToken, storedAccessDigest)
        assertNotEquals(registered.session.refreshToken, storedRefreshDigest)
    }

    @Test
    fun `registration rejects stale terms without consuming proof or writing partial account`() {
        val proof = registrationProof("terms@example.com")
        val result = newUseCases().register(registrationCommand(proof, termsVersion = "obsolete"))

        assertEquals(RegistrationResult.TermsVersionRejected, result)
        assertEquals(0, count("app_users"))
        assertEquals(0, count("user_sessions"))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM auth_continuations WHERE consumed_at IS NOT NULL", Int::class.java))
    }

    @Test
    fun `consumed proof cannot create a second account`() {
        val proof = registrationProof("once@example.com")
        val useCases = newUseCases()
        assertIs<RegistrationResult.Registered>(useCases.register(registrationCommand(proof)))

        assertEquals(RegistrationResult.ContextExpired, useCases.register(registrationCommand(proof)))
        assertEquals(1, count("app_users"))
        assertEquals(1, count("user_sessions"))
    }

    @Test
    fun `proved email already registered invalidates the new continuation without merging accounts`() {
        val useCases = newUseCases()
        val original = registrationProof("registered@example.com")
        assertIs<RegistrationResult.Registered>(useCases.register(registrationCommand(original)))
        val duplicate = registrationProof("registered@example.com")

        assertEquals(
            RegistrationResult.EmailAlreadyRegistered,
            useCases.register(registrationCommand(duplicate)),
        )

        assertEquals(1, count("app_users"))
        assertEquals(1, count("email_identities"))
        assertEquals(1, count("password_credentials"))
        assertEquals(1, count("terms_acceptances"))
        assertEquals(1, count("user_sessions"))
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT count(*) FROM auth_continuations WHERE continuation_id = ? AND consumed_at IS NOT NULL",
                Int::class.java,
                duplicate.continuationId.value,
            ),
        )
    }

    @Test
    fun `password login succeeds and nonexistent email and wrong password share one result`() {
        val proof = registrationProof("login@example.com")
        val useCases = newUseCases()
        assertIs<RegistrationResult.Registered>(useCases.register(registrationCommand(proof)))

        assertIs<AuthenticationResult.Authenticated>(
            useCases.loginWithPassword(
                PasswordLoginCommand(normalizer.normalize("LOGIN@example.com"), "correct unique passphrase"),
            ),
        )
        assertEquals(
            AuthenticationResult.InvalidCredentials,
            useCases.loginWithPassword(
                PasswordLoginCommand(normalizer.normalize("login@example.com"), "incorrect password value"),
            ),
        )
        assertEquals(
            AuthenticationResult.InvalidCredentials,
            useCases.loginWithPassword(
                PasswordLoginCommand(normalizer.normalize("missing@example.com"), "incorrect password value"),
            ),
        )
    }

    @Test
    fun `login code consumes matching purpose once and creates session`() {
        val proof = registrationProof("code-login@example.com")
        val useCases = newUseCases()
        assertIs<RegistrationResult.Registered>(useCases.register(registrationCommand(proof)))
        val login = loginChallenge("code-login@example.com", VerificationPurpose.LOGIN_EMAIL_OTP, "123456")

        assertIs<AuthenticationResult.Authenticated>(
            useCases.loginWithEmailCode(
                EmailCodeLoginCommand(login, normalizer.normalize("code-login@example.com"), VerificationCode.fromUserInput("123456")),
            ),
        )
        assertEquals(
            AuthenticationResult.InvalidOrExpiredCode,
            useCases.loginWithEmailCode(
                EmailCodeLoginCommand(login, normalizer.normalize("code-login@example.com"), VerificationCode.fromUserInput("123456")),
            ),
        )
        assertEquals(2, count("user_sessions"))
    }

    @Test
    fun `registration and reset purpose challenges cannot authenticate a login`() {
        val proof = registrationProof("purpose@example.com")
        val useCases = newUseCases()
        assertIs<RegistrationResult.Registered>(useCases.register(registrationCommand(proof)))
        val registrationCode = loginChallenge("purpose@example.com", VerificationPurpose.REGISTER_EMAIL_VERIFY, "654321")

        assertEquals(
            AuthenticationResult.InvalidOrExpiredCode,
            useCases.loginWithEmailCode(
                EmailCodeLoginCommand(
                    registrationCode,
                    normalizer.normalize("purpose@example.com"),
                    VerificationCode.fromUserInput("654321"),
                ),
            ),
        )
        assertEquals(1, count("user_sessions"))
        assertEquals(
            0,
            jdbc.queryForObject(
                "SELECT failed_attempts FROM verification_challenges WHERE challenge_id = ?",
                Int::class.java,
                registrationCode.value,
            ),
        )
    }

    @Test
    fun `password reset atomically updates password version revokes sessions and consumes proof`() {
        val registration = registrationProof("reset@example.com")
        val useCases = newUseCases()
        val original = assertIs<RegistrationResult.Registered>(useCases.register(registrationCommand(registration)))
        val reset = resetProof("reset@example.com", original.session.currentUser.userId.value)

        assertEquals(
            PasswordResetResult.PASSWORD_UPDATED,
            useCases.resetPassword(
                PasswordResetCommand(
                    reset.continuationId,
                    ContinuationSecret.fromMainInput(reset.secret),
                    normalizer.normalize(reset.email),
                    "new correct passphrase",
                ),
            ),
        )
        assertEquals(
            AuthenticationResult.InvalidCredentials,
            useCases.loginWithPassword(
                PasswordLoginCommand(normalizer.normalize(reset.email), "correct unique passphrase"),
            ),
        )
        assertIs<AuthenticationResult.Authenticated>(
            useCases.loginWithPassword(
                PasswordLoginCommand(normalizer.normalize(reset.email), "new correct passphrase"),
            ),
        )
        assertEquals(2L, jdbc.queryForObject("SELECT password_version FROM password_credentials", Long::class.java))
        assertTrue(
            requireNotNull(
                jdbc.queryForObject(
                    "SELECT count(*) FROM user_sessions WHERE session_id = ? AND status = 'REVOKED'",
                    Int::class.java,
                    original.session.sessionId.value,
                ),
            ) == 1,
        )
    }

    @Test
    fun `invalid reset proof changes neither password nor session`() {
        val registration = registrationProof("reset-invalid@example.com")
        val useCases = newUseCases()
        val original = assertIs<RegistrationResult.Registered>(useCases.register(registrationCommand(registration)))
        val reset = resetProof("reset-invalid@example.com", original.session.currentUser.userId.value)

        assertEquals(
            PasswordResetResult.CONTEXT_EXPIRED,
            useCases.resetPassword(
                PasswordResetCommand(
                    reset.continuationId,
                    ContinuationSecret.fromMainInput("wrong-reset-secret"),
                    normalizer.normalize(reset.email),
                    "new correct passphrase",
                ),
            ),
        )
        assertIs<AuthenticationResult.Authenticated>(
            useCases.loginWithPassword(
                PasswordLoginCommand(normalizer.normalize(reset.email), "correct unique passphrase"),
            ),
        )
        assertEquals(1L, jdbc.queryForObject("SELECT password_version FROM password_credentials", Long::class.java))
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT count(*) FROM user_sessions WHERE session_id = ? AND status = 'ACTIVE'",
                Int::class.java,
                original.session.sessionId.value,
            ),
        )
    }

    private fun newUseCases(): JdbcAuthenticationUseCases =
        JdbcAuthenticationUseCases(
            dataSource = dataSource,
            passwordPolicy = PasswordPolicy(),
            passwordHasher = passwordHasher,
            dummyPasswordDigest = passwordHasher.hash("dummy password fixture"),
            verificationSecretDigester = HmacSha256SecretDigester(pepper),
            sessionSecretDigester = HmacSha256SecretDigester(pepper),
            tokenGenerator = SessionTokenGenerator { "session-token-${UUID.randomUUID()}" },
            sessionPolicy = SessionPolicy(),
            currentTermsVersion = CURRENT_TERMS,
            clock = Clock.fixed(now, ZoneOffset.UTC),
        )

    private fun registrationCommand(
        proof: ProofFixture,
        termsVersion: String = CURRENT_TERMS,
    ) = RegistrationCommand(
        continuationId = proof.continuationId,
        continuationSecret = ContinuationSecret.fromMainInput(proof.secret),
        email = normalizer.normalize(proof.email),
        displayName = "Ada Lovelace",
        password = "correct unique passphrase",
        termsVersion = termsVersion,
    )

    private fun registrationProof(email: String): ProofFixture {
        val challengeId = UUID.randomUUID()
        val continuationId = AuthContinuationId(UUID.randomUUID())
        val secret = "registration-proof-${UUID.randomUUID()}"
        jdbc.update(
            """
            INSERT INTO verification_challenges (
                challenge_id, purpose, normalized_email, code_digest, created_at, expires_at,
                resend_available_at, maximum_attempts, delivery_state, consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 5, 'SENT', ?)
            """.trimIndent(),
            challengeId,
            VerificationPurpose.REGISTER_EMAIL_VERIFY.name,
            email,
            "fixture-digest",
            now.minusSeconds(60).atOffset(ZoneOffset.UTC),
            now.plusSeconds(600).atOffset(ZoneOffset.UTC),
            now.plusSeconds(1).atOffset(ZoneOffset.UTC),
            now.minusSeconds(1).atOffset(ZoneOffset.UTC),
        )
        jdbc.update(
            """
            INSERT INTO auth_continuations (
                continuation_id, purpose, normalized_email, challenge_id, secret_digest, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            continuationId.value,
            VerificationPurpose.REGISTER_EMAIL_VERIFY.name,
            email,
            challengeId,
            digest("continuation:${VerificationPurpose.REGISTER_EMAIL_VERIFY.name}:${continuationId.value}", secret),
            now.minusSeconds(1).atOffset(ZoneOffset.UTC),
            now.plusSeconds(600).atOffset(ZoneOffset.UTC),
        )
        return ProofFixture(continuationId, secret, email)
    }

    private fun loginChallenge(
        email: String,
        purpose: VerificationPurpose,
        code: String,
    ): VerificationChallengeId {
        val challengeId = VerificationChallengeId(UUID.randomUUID())
        jdbc.update(
            """
            INSERT INTO verification_challenges (
                challenge_id, purpose, normalized_email, code_digest, created_at, expires_at,
                resend_available_at, maximum_attempts, delivery_state
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 5, 'SENT')
            """.trimIndent(),
            challengeId.value,
            purpose.name,
            email,
            digest("otp:${purpose.name}:${challengeId.value}", code),
            now.minusSeconds(1).atOffset(ZoneOffset.UTC),
            now.plusSeconds(600).atOffset(ZoneOffset.UTC),
            now.plusSeconds(60).atOffset(ZoneOffset.UTC),
        )
        return challengeId
    }

    private fun resetProof(
        email: String,
        userId: UUID,
    ): ProofFixture {
        val challengeId = UUID.randomUUID()
        val continuationId = AuthContinuationId(UUID.randomUUID())
        val secret = "reset-proof-${UUID.randomUUID()}"
        jdbc.update(
            """
            INSERT INTO verification_challenges (
                challenge_id, purpose, normalized_email, user_id, code_digest, created_at, expires_at,
                resend_available_at, maximum_attempts, delivery_state, consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, 'SENT', ?)
            """.trimIndent(),
            challengeId,
            VerificationPurpose.PASSWORD_RESET.name,
            email,
            userId,
            "fixture-digest",
            now.minusSeconds(60).atOffset(ZoneOffset.UTC),
            now.plusSeconds(600).atOffset(ZoneOffset.UTC),
            now.plusSeconds(1).atOffset(ZoneOffset.UTC),
            now.minusSeconds(1).atOffset(ZoneOffset.UTC),
        )
        jdbc.update(
            """
            INSERT INTO auth_continuations (
                continuation_id, purpose, normalized_email, user_id, challenge_id,
                secret_digest, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            continuationId.value,
            VerificationPurpose.PASSWORD_RESET.name,
            email,
            userId,
            challengeId,
            digest("continuation:${VerificationPurpose.PASSWORD_RESET.name}:${continuationId.value}", secret),
            now.minusSeconds(1).atOffset(ZoneOffset.UTC),
            now.plusSeconds(600).atOffset(ZoneOffset.UTC),
        )
        return ProofFixture(continuationId, secret, email)
    }

    private fun digest(
        namespace: String,
        secret: String,
    ): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(pepper, "HmacSHA256"))
        val value = "$namespace\u0000$secret".toByteArray(StandardCharsets.UTF_8)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(value))
    }

    private fun count(table: String): Int = requireNotNull(jdbc.queryForObject("SELECT count(*) FROM $table", Int::class.java))

    private data class ProofFixture(
        val continuationId: AuthContinuationId,
        val secret: String,
        val email: String,
    )

    private companion object {
        const val CURRENT_TERMS = "2026-09"
    }
}
