package ai.taskpilot.coreapi.access.persistence

import ai.taskpilot.coreapi.access.application.ChallengeDeliveryState
import ai.taskpilot.coreapi.access.application.ChallengeIssueResult
import ai.taskpilot.coreapi.access.application.ChallengeVerificationResult
import ai.taskpilot.coreapi.access.application.ConsumeContinuationCommand
import ai.taskpilot.coreapi.access.application.ContinuationConsumptionResult
import ai.taskpilot.coreapi.access.application.NewAuthContinuation
import ai.taskpilot.coreapi.access.application.NewVerificationChallenge
import ai.taskpilot.coreapi.access.application.RateLimitDecision
import ai.taskpilot.coreapi.access.application.RateLimitEntry
import ai.taskpilot.coreapi.access.application.RateLimitRequest
import ai.taskpilot.coreapi.access.application.RateLimitStore
import ai.taskpilot.coreapi.access.application.VerificationStore
import ai.taskpilot.coreapi.access.application.VerifyChallengeCommand
import ai.taskpilot.coreapi.access.model.AuthContinuationId
import ai.taskpilot.coreapi.access.model.SecretDigest
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.VerificationChallengeId
import ai.taskpilot.coreapi.access.model.VerificationPurpose
import ai.taskpilot.coreapi.access.model.VerificationSubject
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.security.MessageDigest
import java.sql.ResultSet
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource

class JdbcVerificationStore(
    dataSource: DataSource,
) : VerificationStore {
    private val jdbc = JdbcTemplate(dataSource)
    private val transaction = TransactionTemplate(DataSourceTransactionManager(dataSource))
    private val continuations = JdbcContinuationPersistence(jdbc)

    override fun issue(challenge: NewVerificationChallenge): ChallengeIssueResult =
        transaction.requiredResult {
            jdbc.lockSubject(challenge)
            val latest = findLatestChallenge(challenge)
            if (latest != null && latest.deliveryState != ChallengeDeliveryState.FAILED &&
                latest.resendAvailableAt.isAfter(challenge.createdAt)
            ) {
                return@requiredResult ChallengeIssueResult.CoolingDown(
                    latest.challengeId,
                    Duration.between(challenge.createdAt, latest.resendAvailableAt),
                )
            }
            supersedeActiveChallenges(challenge)
            insertChallenge(challenge)
            ChallengeIssueResult.Created
        }

    override fun recordDelivery(
        challengeId: VerificationChallengeId,
        state: ChallengeDeliveryState,
        recordedAt: Instant,
    ) {
        val changed =
            jdbc.update(
                """
                UPDATE verification_challenges
                SET delivery_state = ?, delivery_recorded_at = ?
                WHERE challenge_id = ? AND delivery_state = 'PENDING'
                """.trimIndent(),
                state.name,
                recordedAt.utc(),
                challengeId.value,
            )
        check(changed == 1) { "Verification challenge delivery state could not be recorded" }
    }

    override fun verify(command: VerifyChallengeCommand): ChallengeVerificationResult =
        transaction.requiredResult {
            val challenge =
                findChallengeForUpdate(command.challengeId)
                    ?: return@requiredResult ChallengeVerificationResult.InvalidOrExpired
            if (!challenge.matchesContext(command) || !challenge.isUsableAt(command.now)) {
                return@requiredResult challenge.unavailableResult()
            }
            if (!challenge.codeDigest.constantTimeEquals(command.presentedCodeDigest)) {
                return@requiredResult recordFailedAttempt(challenge)
            }
            consumeChallenge(challenge.challengeId, command.now)
            command.continuation?.let { continuation -> continuations.insert(continuation, challenge) }
            ChallengeVerificationResult.Verified(challenge.subject)
        }

    override fun consumeContinuation(command: ConsumeContinuationCommand): ContinuationConsumptionResult =
        transaction.requiredResult {
            val continuation =
                continuations.findForUpdate(command.continuationId)
                    ?: return@requiredResult ContinuationConsumptionResult.InvalidOrExpired
            if (!continuation.matches(command)) {
                return@requiredResult ContinuationConsumptionResult.InvalidOrExpired
            }
            jdbc.update(
                "UPDATE auth_continuations SET consumed_at = ? WHERE continuation_id = ? AND consumed_at IS NULL",
                command.now.utc(),
                command.continuationId.value,
            )
            ContinuationConsumptionResult.Consumed(continuation.subject)
        }

    private fun findLatestChallenge(challenge: NewVerificationChallenge): StoredChallenge? =
        jdbc
            .query(
                """
                SELECT challenge_id, purpose, normalized_email, user_id, code_digest, expires_at,
                       resend_available_at, maximum_attempts, failed_attempts, delivery_state,
                       consumed_at, superseded_at
                FROM verification_challenges
                WHERE purpose = ? AND normalized_email = ?
                ORDER BY created_at DESC, challenge_id DESC
                LIMIT 1
                FOR UPDATE
                """.trimIndent(),
                storedChallengeRowMapper,
                challenge.purpose.name,
                challenge.subject.normalizedEmail,
            ).singleOrNull()

    private fun supersedeActiveChallenges(challenge: NewVerificationChallenge) {
        jdbc.update(
            """
            UPDATE verification_challenges
            SET superseded_at = ?
            WHERE purpose = ? AND normalized_email = ? AND consumed_at IS NULL AND superseded_at IS NULL
            """.trimIndent(),
            challenge.createdAt.utc(),
            challenge.purpose.name,
            challenge.subject.normalizedEmail,
        )
    }

    private fun insertChallenge(challenge: NewVerificationChallenge) {
        jdbc.update(
            """
            INSERT INTO verification_challenges (
                challenge_id, purpose, normalized_email, user_id, code_digest, created_at, expires_at,
                resend_available_at, maximum_attempts
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            challenge.challengeId.value,
            challenge.purpose.name,
            challenge.subject.normalizedEmail,
            challenge.subject.userId?.value,
            challenge.codeDigest.encoded,
            challenge.createdAt.utc(),
            challenge.expiresAt.utc(),
            challenge.resendAvailableAt.utc(),
            challenge.maximumAttempts,
        )
    }

    private fun findChallengeForUpdate(challengeId: VerificationChallengeId): StoredChallenge? =
        jdbc
            .query(
                """
                SELECT challenge_id, purpose, normalized_email, user_id, code_digest, expires_at,
                       resend_available_at, maximum_attempts, failed_attempts, delivery_state,
                       consumed_at, superseded_at
                FROM verification_challenges
                WHERE challenge_id = ?
                FOR UPDATE
                """.trimIndent(),
                storedChallengeRowMapper,
                challengeId.value,
            ).singleOrNull()

    private fun recordFailedAttempt(challenge: StoredChallenge): ChallengeVerificationResult {
        val attempts = challenge.failedAttempts + 1
        jdbc.update(
            "UPDATE verification_challenges SET failed_attempts = ? WHERE challenge_id = ?",
            attempts,
            challenge.challengeId.value,
        )
        return if (attempts >= challenge.maximumAttempts) {
            ChallengeVerificationResult.TooManyAttempts
        } else {
            ChallengeVerificationResult.InvalidOrExpired
        }
    }

    private fun consumeChallenge(
        challengeId: VerificationChallengeId,
        now: Instant,
    ) {
        val changed =
            jdbc.update(
                "UPDATE verification_challenges SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL",
                now.utc(),
                challengeId.value,
            )
        check(changed == 1) { "Verification challenge was consumed concurrently" }
    }

    private companion object {
        val storedChallengeRowMapper = { rows: ResultSet, _: Int ->
            StoredChallenge(
                challengeId = VerificationChallengeId(rows.getObject("challenge_id", UUID::class.java)),
                purpose = VerificationPurpose.valueOf(rows.getString("purpose")),
                subject = rows.verificationSubject(),
                codeDigest = SecretDigest.fromEncoded(rows.getString("code_digest")),
                expiresAt = rows.getObject("expires_at", OffsetDateTime::class.java).toInstant(),
                resendAvailableAt = rows.getObject("resend_available_at", OffsetDateTime::class.java).toInstant(),
                maximumAttempts = rows.getInt("maximum_attempts"),
                failedAttempts = rows.getInt("failed_attempts"),
                deliveryState = ChallengeDeliveryState.valueOf(rows.getString("delivery_state")),
                consumedAt = rows.instantOrNull("consumed_at"),
                supersededAt = rows.instantOrNull("superseded_at"),
            )
        }
    }
}

private class JdbcContinuationPersistence(
    private val jdbc: JdbcTemplate,
) {
    fun insert(
        continuation: NewAuthContinuation,
        challenge: StoredChallenge,
    ) {
        require(continuation.challengeId == challenge.challengeId)
        require(continuation.purpose == challenge.purpose)
        require(continuation.purpose != VerificationPurpose.LOGIN_EMAIL_OTP)
        jdbc.update(
            """
            INSERT INTO auth_continuations (
                continuation_id, purpose, normalized_email, user_id, challenge_id,
                secret_digest, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            continuation.continuationId.value,
            continuation.purpose.name,
            challenge.subject.normalizedEmail,
            challenge.subject.userId?.value,
            challenge.challengeId.value,
            continuation.secretDigest.encoded,
            continuation.createdAt.utc(),
            continuation.expiresAt.utc(),
        )
    }

    fun findForUpdate(continuationId: AuthContinuationId): StoredContinuation? =
        jdbc
            .query(
                """
                SELECT continuation_id, purpose, normalized_email, user_id,
                       secret_digest, expires_at, consumed_at
                FROM auth_continuations
                WHERE continuation_id = ?
                FOR UPDATE
                """.trimIndent(),
                { rows, _ ->
                    StoredContinuation(
                        continuationId =
                            AuthContinuationId(
                                rows.getObject("continuation_id", UUID::class.java),
                            ),
                        purpose = VerificationPurpose.valueOf(rows.getString("purpose")),
                        subject = rows.verificationSubject(),
                        secretDigest = SecretDigest.fromEncoded(rows.getString("secret_digest")),
                        expiresAt = rows.getObject("expires_at", OffsetDateTime::class.java).toInstant(),
                        consumedAt = rows.instantOrNull("consumed_at"),
                    )
                },
                continuationId.value,
            ).singleOrNull()
}

class JdbcRateLimitStore(
    dataSource: DataSource,
) : RateLimitStore {
    private val jdbc = JdbcTemplate(dataSource)
    private val transaction = TransactionTemplate(DataSourceTransactionManager(dataSource))

    override fun acquire(request: RateLimitRequest): RateLimitDecision =
        transaction.requiredResult {
            val orderedEntries = request.entries.sortedBy { "${it.dimension.name}:${it.protectedKey.encoded}" }
            orderedEntries.forEach { entry -> lockEntry(request, entry) }
            val current = orderedEntries.associateWith { entry -> findBucket(request, entry) }
            val rejection =
                current.values
                    .filterNotNull()
                    .filter { it.expiresAt.isAfter(request.now) }
                    .filter { it.attemptCount >= request.maximumAttempts }
                    .maxOfOrNull { Duration.between(request.now, it.expiresAt) }
            if (rejection != null) {
                return@requiredResult RateLimitDecision.Rejected(rejection)
            }
            current.forEach { (entry, bucket) -> upsertBucket(request, entry, bucket) }
            RateLimitDecision.Allowed
        }

    private fun lockEntry(
        request: RateLimitRequest,
        entry: RateLimitEntry,
    ) {
        jdbc.queryForObject(
            "SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(?, 0))",
            Int::class.java,
            "${request.action.name}:${request.purpose.name}:${entry.dimension.name}:${entry.protectedKey.encoded}",
        )
    }

    private fun findBucket(
        request: RateLimitRequest,
        entry: RateLimitEntry,
    ): StoredRateLimit? =
        jdbc
            .query(
                """
                SELECT expires_at, attempt_count
                FROM verification_rate_limits
                WHERE action = ? AND purpose = ? AND dimension = ? AND protected_key = ?
                FOR UPDATE
                """.trimIndent(),
                { rows, _ ->
                    StoredRateLimit(
                        expiresAt = rows.getObject("expires_at", OffsetDateTime::class.java).toInstant(),
                        attemptCount = rows.getInt("attempt_count"),
                    )
                },
                request.action.name,
                request.purpose.name,
                entry.dimension.name,
                entry.protectedKey.encoded,
            ).singleOrNull()

    private fun upsertBucket(
        request: RateLimitRequest,
        entry: RateLimitEntry,
        bucket: StoredRateLimit?,
    ) {
        if (bucket == null) {
            jdbc.update(
                """
                INSERT INTO verification_rate_limits (
                    action, purpose, dimension, protected_key, window_started_at, expires_at, attempt_count
                ) VALUES (?, ?, ?, ?, ?, ?, 1)
                """.trimIndent(),
                request.action.name,
                request.purpose.name,
                entry.dimension.name,
                entry.protectedKey.encoded,
                request.now.utc(),
                request.now.plus(request.window).utc(),
            )
        } else if (!bucket.expiresAt.isAfter(request.now)) {
            jdbc.update(
                """
                UPDATE verification_rate_limits
                SET window_started_at = ?, expires_at = ?, attempt_count = 1
                WHERE action = ? AND purpose = ? AND dimension = ? AND protected_key = ?
                """.trimIndent(),
                request.now.utc(),
                request.now.plus(request.window).utc(),
                request.action.name,
                request.purpose.name,
                entry.dimension.name,
                entry.protectedKey.encoded,
            )
        } else {
            jdbc.update(
                """
                UPDATE verification_rate_limits
                SET attempt_count = attempt_count + 1
                WHERE action = ? AND purpose = ? AND dimension = ? AND protected_key = ?
                """.trimIndent(),
                request.action.name,
                request.purpose.name,
                entry.dimension.name,
                entry.protectedKey.encoded,
            )
        }
    }
}

private fun JdbcTemplate.lockSubject(challenge: NewVerificationChallenge) {
    queryForObject(
        "SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(?, 0))",
        Int::class.java,
        "${challenge.purpose.name}:${challenge.subject.normalizedEmail}",
    )
}

private data class StoredChallenge(
    val challengeId: VerificationChallengeId,
    val purpose: VerificationPurpose,
    val subject: VerificationSubject,
    val codeDigest: SecretDigest,
    val expiresAt: Instant,
    val resendAvailableAt: Instant,
    val maximumAttempts: Int,
    val failedAttempts: Int,
    val deliveryState: ChallengeDeliveryState,
    val consumedAt: Instant?,
    val supersededAt: Instant?,
) {
    fun matchesContext(command: VerifyChallengeCommand): Boolean =
        purpose == command.purpose && subject.normalizedEmail == command.normalizedEmail

    fun isUsableAt(now: Instant): Boolean =
        deliveryState in setOf(ChallengeDeliveryState.SENT, ChallengeDeliveryState.OUTCOME_UNKNOWN) &&
            consumedAt == null &&
            supersededAt == null &&
            expiresAt.isAfter(now) &&
            failedAttempts < maximumAttempts

    fun unavailableResult(): ChallengeVerificationResult =
        if (failedAttempts >= maximumAttempts) {
            ChallengeVerificationResult.TooManyAttempts
        } else {
            ChallengeVerificationResult.InvalidOrExpired
        }
}

private data class StoredContinuation(
    val continuationId: AuthContinuationId,
    val purpose: VerificationPurpose,
    val subject: VerificationSubject,
    val secretDigest: SecretDigest,
    val expiresAt: Instant,
    val consumedAt: Instant?,
) {
    fun matches(command: ConsumeContinuationCommand): Boolean =
        continuationId == command.continuationId &&
            purpose == command.purpose &&
            subject.normalizedEmail == command.normalizedEmail &&
            consumedAt == null &&
            expiresAt.isAfter(command.now) &&
            secretDigest.constantTimeEquals(command.presentedSecretDigest)
}

private data class StoredRateLimit(
    val expiresAt: Instant,
    val attemptCount: Int,
)

private fun ResultSet.verificationSubject(): VerificationSubject =
    VerificationSubject(
        normalizedEmail = getString("normalized_email"),
        userId = getObject("user_id", UUID::class.java)?.let(::UserId),
    )

private fun ResultSet.instantOrNull(column: String): Instant? =
    getObject(
        column,
        OffsetDateTime::class.java,
    )?.toInstant()

private fun SecretDigest.constantTimeEquals(other: SecretDigest): Boolean =
    MessageDigest.isEqual(encoded.toByteArray(Charsets.US_ASCII), other.encoded.toByteArray(Charsets.US_ASCII))

private fun Instant.utc(): OffsetDateTime = atOffset(ZoneOffset.UTC)

private fun <T> TransactionTemplate.requiredResult(action: () -> T): T =
    requireNotNull(execute { action() }) { "Verification transaction returned no result" }
