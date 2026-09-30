package ai.taskpilot.coreapi.access.persistence

import ai.taskpilot.coreapi.access.application.ACCESS_TOKEN_DIGEST_NAMESPACE
import ai.taskpilot.coreapi.access.application.AuthenticationResult
import ai.taskpilot.coreapi.access.application.AuthenticationUseCases
import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.EmailCodeLoginCommand
import ai.taskpilot.coreapi.access.application.IssuedSession
import ai.taskpilot.coreapi.access.application.PasswordHasher
import ai.taskpilot.coreapi.access.application.PasswordLoginCommand
import ai.taskpilot.coreapi.access.application.PasswordPolicy
import ai.taskpilot.coreapi.access.application.PasswordResetCommand
import ai.taskpilot.coreapi.access.application.PasswordResetResult
import ai.taskpilot.coreapi.access.application.REFRESH_TOKEN_DIGEST_NAMESPACE
import ai.taskpilot.coreapi.access.application.RegistrationCommand
import ai.taskpilot.coreapi.access.application.RegistrationResult
import ai.taskpilot.coreapi.access.application.SecretDigester
import ai.taskpilot.coreapi.access.application.SessionFamilyId
import ai.taskpilot.coreapi.access.application.SessionId
import ai.taskpilot.coreapi.access.application.SessionPolicy
import ai.taskpilot.coreapi.access.application.SessionTokenGenerator
import ai.taskpilot.coreapi.access.application.challengeDigestNamespace
import ai.taskpilot.coreapi.access.application.continuationDigestNamespace
import ai.taskpilot.coreapi.access.model.EmailIdentityId
import ai.taskpilot.coreapi.access.model.PasswordDigest
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.VerificationPurpose
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.security.MessageDigest
import java.sql.ResultSet
import java.time.Clock
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.UUID
import javax.sql.DataSource

// This transactional adapter owns the tightly coupled account authentication invariants.
@Suppress("LongParameterList", "TooManyFunctions")
class JdbcAuthenticationUseCases(
    dataSource: DataSource,
    private val passwordPolicy: PasswordPolicy,
    private val passwordHasher: PasswordHasher,
    private val dummyPasswordDigest: PasswordDigest,
    private val verificationSecretDigester: SecretDigester,
    private val sessionSecretDigester: SecretDigester,
    private val tokenGenerator: SessionTokenGenerator,
    private val sessionPolicy: SessionPolicy,
    private val currentTermsVersion: String,
    private val clock: Clock,
) : AuthenticationUseCases {
    private val jdbc = JdbcTemplate(dataSource)
    private val transaction = TransactionTemplate(DataSourceTransactionManager(dataSource))

    override fun register(command: RegistrationCommand): RegistrationResult {
        if (command.termsVersion != currentTermsVersion) return RegistrationResult.TermsVersionRejected
        passwordPolicy.validate(command.password)
        val passwordDigest = passwordHasher.hash(command.password)
        return try {
            transaction.requiredResult {
                val continuation = lockContinuation(command.continuationId.value)
                val validContinuation =
                    continuation?.matchesRegistration(command, verificationSecretDigester, clock.instant()) == true
                if (!validContinuation) {
                    return@requiredResult RegistrationResult.ContextExpired
                }
                val now = clock.instant().truncatedTo(ChronoUnit.MILLIS)
                val userId = UserId(UUID.randomUUID())
                insertIdentity(command, userId, passwordDigest, now)
                consumeContinuation(command.continuationId.value, now)
                RegistrationResult.Registered(issueSession(userId, now))
            }
        } catch (failure: DataIntegrityViolationException) {
            if (!failure.isNormalizedEmailConflict()) throw failure
            invalidateMatchingRegistrationContinuation(command)
            RegistrationResult.EmailAlreadyRegistered
        }
    }

    private fun invalidateMatchingRegistrationContinuation(command: RegistrationCommand) {
        transaction.requiredResult {
            val continuation = lockContinuation(command.continuationId.value)
            val stillValid =
                continuation?.matchesRegistration(
                    command,
                    verificationSecretDigester,
                    clock.instant(),
                ) == true
            if (stillValid) {
                consumeContinuation(command.continuationId.value, clock.instant().truncatedTo(ChronoUnit.MILLIS))
            }
        }
    }

    override fun loginWithPassword(command: PasswordLoginCommand): AuthenticationResult {
        val credential = findCredential(command.email.normalized)
        val digest = credential?.passwordDigest ?: dummyPasswordDigest
        if (!passwordHasher.matches(command.password, digest) || credential == null) {
            return AuthenticationResult.InvalidCredentials
        }
        return transaction.requiredResult {
            if (passwordHasher.needsUpgrade(credential.passwordDigest)) {
                replacePasswordDigest(credential.user.userId, passwordHasher.hash(command.password), clock.instant())
            }
            AuthenticationResult.Authenticated(issueSession(credential.user.userId, clock.instant()))
        }
    }

    override fun loginWithEmailCode(command: EmailCodeLoginCommand): AuthenticationResult =
        transaction.requiredResult {
            val now = clock.instant().truncatedTo(ChronoUnit.MILLIS)
            val challenge = lockChallenge(command.challengeId.value)
            if (challenge == null || !challenge.matchesLogin(command, verificationSecretDigester, now)) {
                challenge?.recordFailedAttempt(jdbc)
                return@requiredResult AuthenticationResult.InvalidOrExpiredCode
            }
            val user =
                findUserByEmail(command.email.normalized)
                    ?: return@requiredResult AuthenticationResult.InvalidOrExpiredCode
            consumeChallenge(command.challengeId.value, now)
            AuthenticationResult.Authenticated(issueSession(user.userId, now))
        }

    override fun resetPassword(command: PasswordResetCommand): PasswordResetResult {
        passwordPolicy.validate(command.newPassword)
        val replacement = passwordHasher.hash(command.newPassword)
        return transaction.requiredResult {
            val now = clock.instant().truncatedTo(ChronoUnit.MILLIS)
            val continuation = lockContinuation(command.continuationId.value)
            if (continuation == null || !continuation.matchesReset(command, verificationSecretDigester, now)) {
                return@requiredResult PasswordResetResult.CONTEXT_EXPIRED
            }
            val userId = continuation.userId ?: return@requiredResult PasswordResetResult.CONTEXT_EXPIRED
            replacePasswordDigest(userId, replacement, now)
            jdbc.update(
                """
                UPDATE user_sessions
                SET status = 'REVOKED', revoked_at = ?
                WHERE user_id = ? AND status = 'ACTIVE'
                """.trimIndent(),
                now.utc(),
                userId.value,
            )
            consumeContinuation(command.continuationId.value, now)
            PasswordResetResult.PASSWORD_UPDATED
        }
    }

    private fun insertIdentity(
        command: RegistrationCommand,
        userId: UserId,
        passwordDigest: PasswordDigest,
        now: Instant,
    ) {
        jdbc.update(
            "INSERT INTO app_users (user_id, display_name, status, created_at) VALUES (?, ?, 'ACTIVE', ?)",
            userId.value,
            command.displayName.trim(),
            now.utc(),
        )
        jdbc.update(
            """
            INSERT INTO email_identities (
                email_identity_id, user_id, normalized_email, display_email, verified_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            EmailIdentityId(UUID.randomUUID()).value,
            userId.value,
            command.email.normalized,
            command.email.display,
            now.utc(),
            now.utc(),
        )
        jdbc.update(
            """
            INSERT INTO password_credentials (user_id, argon2id_digest, password_version, changed_at)
            VALUES (?, ?, 1, ?)
            """.trimIndent(),
            userId.value,
            passwordDigest.encoded,
            now.utc(),
        )
        jdbc.update(
            "INSERT INTO terms_acceptances (user_id, terms_version, accepted_at) VALUES (?, ?, ?)",
            userId.value,
            command.termsVersion,
            now.utc(),
        )
    }

    private fun issueSession(
        userId: UserId,
        now: Instant,
    ): IssuedSession {
        val user = requireNotNull(findUser(userId)) { "Session user disappeared" }
        val sessionId = SessionId(UUID.randomUUID())
        val familyId = SessionFamilyId(UUID.randomUUID())
        val accessToken = tokenGenerator.generate()
        val refreshToken = tokenGenerator.generate()
        val accessExpiry = now.plus(sessionPolicy.accessTtl)
        val refreshExpiry = now.plus(sessionPolicy.refreshInactivityTtl)
        val absoluteExpiry = now.plus(sessionPolicy.absoluteTtl)
        jdbc.update(
            """
            INSERT INTO user_sessions (
                session_id, family_id, user_id, access_token_digest, access_expires_at,
                refresh_token_digest, refresh_expires_at, absolute_expires_at,
                generation, status, created_at, last_refreshed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?)
            """.trimIndent(),
            sessionId.value,
            familyId.value,
            userId.value,
            sessionSecretDigester.digest(ACCESS_TOKEN_DIGEST_NAMESPACE, accessToken).encoded,
            accessExpiry.utc(),
            sessionSecretDigester.digest(REFRESH_TOKEN_DIGEST_NAMESPACE, refreshToken).encoded,
            refreshExpiry.utc(),
            absoluteExpiry.utc(),
            now.utc(),
            now.utc(),
        )
        return IssuedSession(
            sessionId,
            familyId,
            accessToken,
            accessExpiry,
            refreshToken,
            refreshExpiry,
            CurrentUserView(user.userId, user.displayName, user.email),
        )
    }

    private fun findCredential(normalizedEmail: String): StoredCredential? =
        jdbc
            .query(
                """
                SELECT u.user_id, u.display_name, e.normalized_email, p.argon2id_digest
                FROM app_users u
                JOIN email_identities e ON e.user_id = u.user_id
                JOIN password_credentials p ON p.user_id = u.user_id
                WHERE e.normalized_email = ? AND u.status = 'ACTIVE'
                """.trimIndent(),
                { rows, _ ->
                    StoredCredential(
                        rows.userView(),
                        PasswordDigest.fromEncoded(rows.getString("argon2id_digest")),
                    )
                },
                normalizedEmail,
            ).singleOrNull()

    private fun findUserByEmail(normalizedEmail: String): StoredUser? =
        jdbc
            .query(
                """
                SELECT u.user_id, u.display_name, e.normalized_email
                FROM app_users u JOIN email_identities e ON e.user_id = u.user_id
                WHERE e.normalized_email = ? AND u.status = 'ACTIVE'
                """.trimIndent(),
                { rows, _ -> rows.userView() },
                normalizedEmail,
            ).singleOrNull()

    private fun findUser(userId: UserId): StoredUser? =
        jdbc
            .query(
                """
                SELECT u.user_id, u.display_name, e.normalized_email
                FROM app_users u JOIN email_identities e ON e.user_id = u.user_id
                WHERE u.user_id = ? AND u.status = 'ACTIVE'
                """.trimIndent(),
                { rows, _ -> rows.userView() },
                userId.value,
            ).singleOrNull()

    private fun replacePasswordDigest(
        userId: UserId,
        digest: PasswordDigest,
        now: Instant,
    ) {
        check(
            jdbc.update(
                """
                UPDATE password_credentials
                SET argon2id_digest = ?, password_version = password_version + 1, changed_at = ?
                WHERE user_id = ?
                """.trimIndent(),
                digest.encoded,
                now.utc(),
                userId.value,
            ) == 1,
        ) { "Password credential disappeared" }
    }

    private fun lockContinuation(id: UUID): StoredAuthContinuation? =
        jdbc
            .query(
                """
                SELECT continuation_id, purpose, normalized_email, user_id, secret_digest, expires_at, consumed_at
                FROM auth_continuations WHERE continuation_id = ? FOR UPDATE
                """.trimIndent(),
                { rows, _ ->
                    StoredAuthContinuation(
                        purpose = VerificationPurpose.valueOf(rows.getString("purpose")),
                        normalizedEmail = rows.getString("normalized_email"),
                        userId = rows.getObject("user_id", UUID::class.java)?.let(::UserId),
                        secretDigest = rows.getString("secret_digest"),
                        expiresAt = rows.getObject("expires_at", OffsetDateTime::class.java).toInstant(),
                        consumedAt = rows.getObject("consumed_at", OffsetDateTime::class.java)?.toInstant(),
                    )
                },
                id,
            ).singleOrNull()

    private fun lockChallenge(id: UUID): StoredLoginChallenge? =
        jdbc
            .query(
                """
                SELECT purpose, normalized_email, code_digest, expires_at, maximum_attempts,
                       failed_attempts, delivery_state, consumed_at, superseded_at
                FROM verification_challenges WHERE challenge_id = ? FOR UPDATE
                """.trimIndent(),
                { rows, _ ->
                    StoredLoginChallenge(
                        purpose = VerificationPurpose.valueOf(rows.getString("purpose")),
                        normalizedEmail = rows.getString("normalized_email"),
                        codeDigest = rows.getString("code_digest"),
                        expiresAt = rows.getObject("expires_at", OffsetDateTime::class.java).toInstant(),
                        maximumAttempts = rows.getInt("maximum_attempts"),
                        failedAttempts = rows.getInt("failed_attempts"),
                        deliveryState = rows.getString("delivery_state"),
                        consumedAt = rows.getObject("consumed_at", OffsetDateTime::class.java)?.toInstant(),
                        supersededAt = rows.getObject("superseded_at", OffsetDateTime::class.java)?.toInstant(),
                        challengeId = id,
                    )
                },
                id,
            ).singleOrNull()

    private fun consumeContinuation(
        id: UUID,
        now: Instant,
    ) {
        val updated =
            jdbc.update(
                "UPDATE auth_continuations SET consumed_at = ? WHERE continuation_id = ?",
                now.utc(),
                id,
            )
        check(updated == 1)
    }

    private fun consumeChallenge(
        id: UUID,
        now: Instant,
    ) {
        val updated =
            jdbc.update(
                "UPDATE verification_challenges SET consumed_at = ? WHERE challenge_id = ?",
                now.utc(),
                id,
            )
        check(updated == 1)
    }

    private data class StoredUser(
        val userId: UserId,
        val displayName: String,
        val email: String,
    )

    private data class StoredCredential(
        val user: StoredUser,
        val passwordDigest: PasswordDigest,
    )

    private data class StoredAuthContinuation(
        val purpose: VerificationPurpose,
        val normalizedEmail: String,
        val userId: UserId?,
        val secretDigest: String,
        val expiresAt: Instant,
        val consumedAt: Instant?,
    ) {
        fun matchesRegistration(
            command: RegistrationCommand,
            digester: SecretDigester,
            now: Instant,
        ): Boolean =
            purpose == VerificationPurpose.REGISTER_EMAIL_VERIFY &&
                normalizedEmail == command.email.normalized &&
                userId == null && consumedAt == null && expiresAt.isAfter(now) &&
                matchesSecret(
                    digester
                        .digest(
                            continuationDigestNamespace(command.continuationId, purpose),
                            command.continuationSecret.value,
                        ).encoded,
                )

        fun matchesReset(
            command: PasswordResetCommand,
            digester: SecretDigester,
            now: Instant,
        ): Boolean =
            purpose == VerificationPurpose.PASSWORD_RESET &&
                normalizedEmail == command.email.normalized &&
                userId != null && consumedAt == null && expiresAt.isAfter(now) &&
                matchesSecret(
                    digester
                        .digest(
                            continuationDigestNamespace(command.continuationId, purpose),
                            command.continuationSecret.value,
                        ).encoded,
                )

        private fun matchesSecret(presented: String): Boolean =
            MessageDigest.isEqual(secretDigest.toByteArray(Charsets.US_ASCII), presented.toByteArray(Charsets.US_ASCII))
    }

    private data class StoredLoginChallenge(
        val challengeId: UUID,
        val purpose: VerificationPurpose,
        val normalizedEmail: String,
        val codeDigest: String,
        val expiresAt: Instant,
        val maximumAttempts: Int,
        val failedAttempts: Int,
        val deliveryState: String,
        val consumedAt: Instant?,
        val supersededAt: Instant?,
    ) {
        fun matchesLogin(
            command: EmailCodeLoginCommand,
            digester: SecretDigester,
            now: Instant,
        ): Boolean =
            purpose == VerificationPurpose.LOGIN_EMAIL_OTP && normalizedEmail == command.email.normalized &&
                deliveryState in setOf("SENT", "OUTCOME_UNKNOWN") && consumedAt == null && supersededAt == null &&
                expiresAt.isAfter(now) && failedAttempts < maximumAttempts &&
                MessageDigest.isEqual(
                    codeDigest.toByteArray(Charsets.US_ASCII),
                    digester
                        .digest(
                            challengeDigestNamespace(command.challengeId, VerificationPurpose.LOGIN_EMAIL_OTP),
                            command.code.value,
                        ).encoded
                        .toByteArray(Charsets.US_ASCII),
                )

        @Suppress("ComplexCondition")
        fun recordFailedAttempt(jdbc: JdbcTemplate) {
            if (purpose == VerificationPurpose.LOGIN_EMAIL_OTP && consumedAt == null && supersededAt == null &&
                failedAttempts < maximumAttempts
            ) {
                jdbc.update(
                    "UPDATE verification_challenges SET failed_attempts = failed_attempts + 1 WHERE challenge_id = ?",
                    challengeId,
                )
            }
        }
    }

    private fun ResultSet.userView(): StoredUser =
        StoredUser(
            UserId(getObject("user_id", UUID::class.java)),
            getString("display_name"),
            getString("normalized_email"),
        )

    private fun Throwable.isNormalizedEmailConflict(): Boolean =
        generateSequence<Throwable>(this) { it.cause }
            .any { it.message?.contains("email_identities_normalized_email_unique") == true }

    private fun Instant.utc(): OffsetDateTime = atOffset(ZoneOffset.UTC)

    private fun <T> TransactionTemplate.requiredResult(action: () -> T): T =
        requireNotNull(execute { action() }) { "Authentication transaction returned no result" }
}
