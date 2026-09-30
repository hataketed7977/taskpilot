package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.AuthContinuationId
import ai.taskpilot.coreapi.access.model.ContinuationSecret
import ai.taskpilot.coreapi.access.model.EmailAddress
import ai.taskpilot.coreapi.access.model.IssuedContinuation
import ai.taskpilot.coreapi.access.model.SecretDigest
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.VerificationChallengeId
import ai.taskpilot.coreapi.access.model.VerificationCode
import ai.taskpilot.coreapi.access.model.VerificationPurpose
import ai.taskpilot.coreapi.access.model.VerificationSubject
import java.time.Duration
import java.time.Instant

enum class ChallengeDeliveryState {
    PENDING,
    SENT,
    OUTCOME_UNKNOWN,
    SUPPRESSED,
    FAILED,
}

data class NewVerificationChallenge(
    val challengeId: VerificationChallengeId,
    val purpose: VerificationPurpose,
    val subject: VerificationSubject,
    val codeDigest: SecretDigest,
    val createdAt: Instant,
    val expiresAt: Instant,
    val resendAvailableAt: Instant,
    val maximumAttempts: Int,
)

sealed interface ChallengeIssueResult {
    data object Created : ChallengeIssueResult

    data class CoolingDown(
        val challengeId: VerificationChallengeId,
        val retryAfter: Duration,
    ) : ChallengeIssueResult
}

data class NewAuthContinuation(
    val continuationId: AuthContinuationId,
    val purpose: VerificationPurpose,
    val challengeId: VerificationChallengeId,
    val secretDigest: SecretDigest,
    val createdAt: Instant,
    val expiresAt: Instant,
)

data class VerifyChallengeCommand(
    val challengeId: VerificationChallengeId,
    val purpose: VerificationPurpose,
    val normalizedEmail: String,
    val presentedCodeDigest: SecretDigest,
    val now: Instant,
    val continuation: NewAuthContinuation?,
)

sealed interface ChallengeVerificationResult {
    data class Verified(
        val subject: VerificationSubject,
    ) : ChallengeVerificationResult

    data object InvalidOrExpired : ChallengeVerificationResult

    data object TooManyAttempts : ChallengeVerificationResult
}

data class ConsumeContinuationCommand(
    val continuationId: AuthContinuationId,
    val purpose: VerificationPurpose,
    val normalizedEmail: String,
    val presentedSecretDigest: SecretDigest,
    val now: Instant,
)

sealed interface ContinuationConsumptionResult {
    data class Consumed(
        val subject: VerificationSubject,
    ) : ContinuationConsumptionResult

    data object InvalidOrExpired : ContinuationConsumptionResult
}

interface VerificationStore {
    fun issue(challenge: NewVerificationChallenge): ChallengeIssueResult

    fun recordDelivery(
        challengeId: VerificationChallengeId,
        state: ChallengeDeliveryState,
        recordedAt: Instant,
    )

    fun verify(command: VerifyChallengeCommand): ChallengeVerificationResult

    fun consumeContinuation(command: ConsumeContinuationCommand): ContinuationConsumptionResult
}

enum class RateLimitAction {
    REQUEST_CODE,
    VERIFY_CODE,
}

enum class RateLimitDimension {
    EMAIL,
    SOURCE_NETWORK,
    DEVICE_INSTALLATION,
}

data class RateLimitEntry(
    val dimension: RateLimitDimension,
    val protectedKey: SecretDigest,
)

data class RateLimitRequest(
    val action: RateLimitAction,
    val purpose: VerificationPurpose,
    val entries: List<RateLimitEntry>,
    val maximumAttempts: Int,
    val window: Duration,
    val now: Instant,
)

sealed interface RateLimitDecision {
    data object Allowed : RateLimitDecision

    data class Rejected(
        val retryAfter: Duration,
    ) : RateLimitDecision
}

fun interface RateLimitStore {
    fun acquire(request: RateLimitRequest): RateLimitDecision
}

data class VerificationRequestSignals(
    val sourceNetwork: String,
    val deviceInstallationId: String,
)

class VerificationRateLimiter(
    private val store: RateLimitStore,
    private val keyDigester: SecretDigester,
    private val maximumAttempts: Int,
    private val window: Duration,
) {
    init {
        require(maximumAttempts > 0)
        require(!window.isNegative && !window.isZero)
    }

    fun acquire(
        action: RateLimitAction,
        purpose: VerificationPurpose,
        normalizedEmail: String,
        signals: VerificationRequestSignals,
        now: Instant,
    ): RateLimitDecision {
        val protectedValues =
            mapOf(
                RateLimitDimension.EMAIL to normalizedEmail,
                RateLimitDimension.SOURCE_NETWORK to signals.sourceNetwork,
                RateLimitDimension.DEVICE_INSTALLATION to signals.deviceInstallationId,
            )
        val entries =
            protectedValues.map { (dimension, value) ->
                RateLimitEntry(
                    dimension,
                    keyDigester.digest("rate:${action.name}:${purpose.name}:${dimension.name}", value),
                )
            }
        return store.acquire(RateLimitRequest(action, purpose, entries, maximumAttempts, window, now))
    }
}

enum class VerificationMailTemplate {
    REGISTRATION_CODE,
    LOGIN_CODE,
    PASSWORD_RESET_CODE,
}

data class VerificationMailCommand(
    val template: VerificationMailTemplate,
    val recipient: String,
    val code: VerificationCode,
    val expiresAt: Instant,
    val correlationId: String,
)

enum class MailDeliveryOutcome {
    DELIVERED,
    DEFINITE_FAILURE,
    OUTCOME_UNKNOWN,
    TIMEOUT,
}

fun interface VerificationMailSender {
    fun send(command: VerificationMailCommand): MailDeliveryResult
}

data class MailDeliveryResult(
    val outcome: MailDeliveryOutcome,
    val safeProviderMessageId: String? = null,
)

enum class VerificationDeliveryEligibility {
    DELIVER,
    SUPPRESS,
}

data class RequestVerificationCodeCommand(
    val email: EmailAddress,
    val purpose: VerificationPurpose,
    val userId: UserId?,
    val deliveryEligibility: VerificationDeliveryEligibility,
    val signals: VerificationRequestSignals,
    val correlationId: String,
)

sealed interface RequestVerificationCodeResult {
    data class Accepted(
        val challengeId: VerificationChallengeId,
        val retryAfter: Duration,
    ) : RequestVerificationCodeResult

    data class RateLimited(
        val retryAfter: Duration,
    ) : RequestVerificationCodeResult

    data object TemporarilyUnavailable : RequestVerificationCodeResult
}

data class VerifyCodeCommand(
    val challengeId: VerificationChallengeId,
    val purpose: VerificationPurpose,
    val normalizedEmail: String,
    val code: VerificationCode,
    val signals: VerificationRequestSignals,
)

sealed interface VerifyCodeResult {
    data class LoginVerified(
        val subject: VerificationSubject,
    ) : VerifyCodeResult

    data class ContinuationIssued(
        val continuation: IssuedContinuation,
    ) : VerifyCodeResult

    data object InvalidOrExpired : VerifyCodeResult

    data object TooManyAttempts : VerifyCodeResult

    data class RateLimited(
        val retryAfter: Duration,
    ) : VerifyCodeResult
}

data class VerificationSecurityComponents(
    val requestRateLimiter: VerificationRateLimiter,
    val codeVerificationRateLimiter: VerificationRateLimiter,
    val codeGenerator: VerificationCodeGenerator,
    val continuationSecretGenerator: ContinuationSecretGenerator,
    val challengeDigester: SecretDigester,
    val continuationDigester: SecretDigester,
    val policy: VerificationPolicy,
)

class VerificationChallengeService(
    private val store: VerificationStore,
    private val security: VerificationSecurityComponents,
    private val mailSender: VerificationMailSender,
    private val clock: java.time.Clock,
) {
    fun requestCode(command: RequestVerificationCodeCommand): RequestVerificationCodeResult {
        val now = clock.instant()
        when (
            val rateLimit =
                acquireRateLimit(
                    RateLimitAction.REQUEST_CODE,
                    command.purpose,
                    command.email.normalized,
                    command.signals,
                    now,
                )
        ) {
            RateLimitDecision.Allowed -> Unit
            is RateLimitDecision.Rejected -> return RequestVerificationCodeResult.RateLimited(rateLimit.retryAfter)
        }
        val challengeId = VerificationChallengeId(java.util.UUID.randomUUID())
        val code = security.codeGenerator.generate()
        val challenge =
            NewVerificationChallenge(
                challengeId = challengeId,
                purpose = command.purpose,
                subject = VerificationSubject(command.email.normalized, command.userId),
                codeDigest =
                    security.challengeDigester.digest(
                        challengeDigestNamespace(challengeId, command.purpose),
                        code.value,
                    ),
                createdAt = now,
                expiresAt = now.plus(security.policy.challengeTtl),
                resendAvailableAt = now.plus(security.policy.resendCooldown),
                maximumAttempts = security.policy.maximumAttempts,
            )
        return when (val issued = store.issue(challenge)) {
            ChallengeIssueResult.Created -> {
                deliverOrSuppress(command, challenge, code, now)
            }

            is ChallengeIssueResult.CoolingDown -> {
                RequestVerificationCodeResult.Accepted(issued.challengeId, issued.retryAfter)
            }
        }
    }

    fun verifyCode(command: VerifyCodeCommand): VerifyCodeResult {
        val now = clock.instant()
        when (
            val rateLimit =
                security.codeVerificationRateLimiter.acquire(
                    RateLimitAction.VERIFY_CODE,
                    command.purpose,
                    command.normalizedEmail,
                    command.signals,
                    now,
                )
        ) {
            RateLimitDecision.Allowed -> Unit
            is RateLimitDecision.Rejected -> return VerifyCodeResult.RateLimited(rateLimit.retryAfter)
        }
        val continuation = newContinuation(command, now)
        val result =
            store.verify(
                VerifyChallengeCommand(
                    challengeId = command.challengeId,
                    purpose = command.purpose,
                    normalizedEmail = command.normalizedEmail,
                    presentedCodeDigest =
                        security.challengeDigester.digest(
                            challengeDigestNamespace(command.challengeId, command.purpose),
                            command.code.value,
                        ),
                    now = now,
                    continuation = continuation?.record,
                ),
            )
        return when (result) {
            is ChallengeVerificationResult.Verified -> {
                continuation?.let { VerifyCodeResult.ContinuationIssued(it.issued) }
                    ?: VerifyCodeResult.LoginVerified(result.subject)
            }

            ChallengeVerificationResult.InvalidOrExpired -> {
                VerifyCodeResult.InvalidOrExpired
            }

            ChallengeVerificationResult.TooManyAttempts -> {
                VerifyCodeResult.TooManyAttempts
            }
        }
    }

    fun acquireVerificationRateLimit(
        purpose: VerificationPurpose,
        normalizedEmail: String,
        signals: VerificationRequestSignals,
    ): RateLimitDecision =
        security.codeVerificationRateLimiter.acquire(
            RateLimitAction.VERIFY_CODE,
            purpose,
            normalizedEmail,
            signals,
            clock.instant(),
        )

    fun consumeContinuation(
        continuationId: AuthContinuationId,
        purpose: VerificationPurpose,
        normalizedEmail: String,
        secret: ContinuationSecret,
    ): ContinuationConsumptionResult =
        store.consumeContinuation(
            ConsumeContinuationCommand(
                continuationId = continuationId,
                purpose = purpose,
                normalizedEmail = normalizedEmail,
                presentedSecretDigest =
                    security.continuationDigester.digest(
                        continuationDigestNamespace(continuationId, purpose),
                        secret.value,
                    ),
                now = clock.instant(),
            ),
        )

    private fun deliverOrSuppress(
        command: RequestVerificationCodeCommand,
        challenge: NewVerificationChallenge,
        code: VerificationCode,
        now: Instant,
    ): RequestVerificationCodeResult {
        if (command.deliveryEligibility == VerificationDeliveryEligibility.SUPPRESS) {
            store.recordDelivery(challenge.challengeId, ChallengeDeliveryState.SUPPRESSED, now)
            return RequestVerificationCodeResult.Accepted(challenge.challengeId, security.policy.resendCooldown)
        }
        val delivery =
            mailSender.send(
                VerificationMailCommand(
                    template = templateFor(command.purpose),
                    recipient = command.email.display,
                    code = code,
                    expiresAt = challenge.expiresAt,
                    correlationId = command.correlationId,
                ),
            )
        return when (delivery.outcome) {
            MailDeliveryOutcome.DELIVERED -> {
                store.recordDelivery(challenge.challengeId, ChallengeDeliveryState.SENT, now)
                RequestVerificationCodeResult.Accepted(challenge.challengeId, security.policy.resendCooldown)
            }

            MailDeliveryOutcome.DEFINITE_FAILURE -> {
                store.recordDelivery(challenge.challengeId, ChallengeDeliveryState.FAILED, now)
                RequestVerificationCodeResult.TemporarilyUnavailable
            }

            MailDeliveryOutcome.OUTCOME_UNKNOWN, MailDeliveryOutcome.TIMEOUT -> {
                store.recordDelivery(challenge.challengeId, ChallengeDeliveryState.OUTCOME_UNKNOWN, now)
                RequestVerificationCodeResult.Accepted(challenge.challengeId, security.policy.resendCooldown)
            }
        }
    }

    private fun newContinuation(
        command: VerifyCodeCommand,
        now: Instant,
    ): PendingContinuation? {
        if (command.purpose == VerificationPurpose.LOGIN_EMAIL_OTP) return null
        val continuationId = AuthContinuationId(java.util.UUID.randomUUID())
        val secret = security.continuationSecretGenerator.generate()
        val expiresAt = now.plus(security.policy.continuationTtl)
        return PendingContinuation(
            record =
                NewAuthContinuation(
                    continuationId = continuationId,
                    purpose = command.purpose,
                    challengeId = command.challengeId,
                    secretDigest =
                        security.continuationDigester.digest(
                            continuationDigestNamespace(continuationId, command.purpose),
                            secret.value,
                        ),
                    createdAt = now,
                    expiresAt = expiresAt,
                ),
            issued = IssuedContinuation(continuationId, command.purpose, secret, expiresAt),
        )
    }

    private fun acquireRateLimit(
        action: RateLimitAction,
        purpose: VerificationPurpose,
        normalizedEmail: String,
        signals: VerificationRequestSignals,
        now: Instant,
    ): RateLimitDecision = security.requestRateLimiter.acquire(action, purpose, normalizedEmail, signals, now)

    private fun templateFor(purpose: VerificationPurpose): VerificationMailTemplate =
        when (purpose) {
            VerificationPurpose.REGISTER_EMAIL_VERIFY -> VerificationMailTemplate.REGISTRATION_CODE
            VerificationPurpose.LOGIN_EMAIL_OTP -> VerificationMailTemplate.LOGIN_CODE
            VerificationPurpose.PASSWORD_RESET -> VerificationMailTemplate.PASSWORD_RESET_CODE
        }

    private data class PendingContinuation(
        val record: NewAuthContinuation,
        val issued: IssuedContinuation,
    )
}
