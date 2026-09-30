package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.ChallengeDeliveryState
import ai.taskpilot.coreapi.access.application.ChallengeIssueResult
import ai.taskpilot.coreapi.access.application.ChallengeVerificationResult
import ai.taskpilot.coreapi.access.application.ConsumeContinuationCommand
import ai.taskpilot.coreapi.access.application.ContinuationConsumptionResult
import ai.taskpilot.coreapi.access.application.ContinuationSecretGenerator
import ai.taskpilot.coreapi.access.application.HmacSha256SecretDigester
import ai.taskpilot.coreapi.access.application.MailDeliveryOutcome
import ai.taskpilot.coreapi.access.application.MailDeliveryResult
import ai.taskpilot.coreapi.access.application.NewVerificationChallenge
import ai.taskpilot.coreapi.access.application.RateLimitAction
import ai.taskpilot.coreapi.access.application.RateLimitDecision
import ai.taskpilot.coreapi.access.application.RateLimitRequest
import ai.taskpilot.coreapi.access.application.RateLimitStore
import ai.taskpilot.coreapi.access.application.RequestVerificationCodeCommand
import ai.taskpilot.coreapi.access.application.RequestVerificationCodeResult
import ai.taskpilot.coreapi.access.application.SecretDigester
import ai.taskpilot.coreapi.access.application.VerificationChallengeService
import ai.taskpilot.coreapi.access.application.VerificationCodeGenerator
import ai.taskpilot.coreapi.access.application.VerificationDeliveryEligibility
import ai.taskpilot.coreapi.access.application.VerificationMailCommand
import ai.taskpilot.coreapi.access.application.VerificationMailSender
import ai.taskpilot.coreapi.access.application.VerificationMailTemplate
import ai.taskpilot.coreapi.access.application.VerificationPolicy
import ai.taskpilot.coreapi.access.application.VerificationRateLimiter
import ai.taskpilot.coreapi.access.application.VerificationRequestSignals
import ai.taskpilot.coreapi.access.application.VerificationSecurityComponents
import ai.taskpilot.coreapi.access.application.VerificationStore
import ai.taskpilot.coreapi.access.application.VerifyChallengeCommand
import ai.taskpilot.coreapi.access.application.VerifyCodeCommand
import ai.taskpilot.coreapi.access.application.VerifyCodeResult
import ai.taskpilot.coreapi.access.model.AuthContinuationId
import ai.taskpilot.coreapi.access.model.ContinuationSecret
import ai.taskpilot.coreapi.access.model.EmailAddress
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.VerificationChallengeId
import ai.taskpilot.coreapi.access.model.VerificationCode
import ai.taskpilot.coreapi.access.model.VerificationPurpose
import ai.taskpilot.coreapi.access.model.VerificationSubject
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNull

class VerificationChallengeServiceTest {
    @Test
    fun `eligible and suppressed registration requests have the same accepted result shape and limiter path`() {
        val eligible = fixture(MailDeliveryOutcome.DELIVERED)
        val suppressed = fixture(MailDeliveryOutcome.DELIVERED)

        val eligibleResult = eligible.service.requestCode(request(VerificationDeliveryEligibility.DELIVER))
        val suppressedResult = suppressed.service.requestCode(request(VerificationDeliveryEligibility.SUPPRESS))

        assertIs<RequestVerificationCodeResult.Accepted>(eligibleResult)
        assertIs<RequestVerificationCodeResult.Accepted>(suppressedResult)
        assertEquals(
            VerificationPurpose.REGISTER_EMAIL_VERIFY,
            eligible.store.issued
                .single()
                .purpose,
        )
        assertEquals(
            VerificationPurpose.REGISTER_EMAIL_VERIFY,
            suppressed.store.issued
                .single()
                .purpose,
        )
        assertEquals(
            eligible.limiter.requests.single().entries.map {
                it.dimension
            },
            suppressed.limiter.requests
                .single()
                .entries
                .map { it.dimension },
        )
        assertEquals(1, eligible.mail.commands.size)
        assertEquals(0, suppressed.mail.commands.size)
        assertEquals(ChallengeDeliveryState.SENT, eligible.store.deliveryState)
        assertEquals(ChallengeDeliveryState.SUPPRESSED, suppressed.store.deliveryState)
    }

    @Test
    fun `all request purposes map to isolated digest namespace and mail template`() {
        val purposes = VerificationPurpose.entries

        purposes.forEach { purpose ->
            val fixture = fixture(MailDeliveryOutcome.DELIVERED)
            fixture.service.requestCode(request(VerificationDeliveryEligibility.DELIVER, purpose))

            assertEquals(
                purpose,
                fixture.store.issued
                    .single()
                    .purpose,
            )
            assertEquals(
                templateFor(purpose),
                fixture.mail.commands
                    .single()
                    .template,
            )
        }

        val digester = digester()
        assertNotEquals(
            digester.digest("otp:${purposes[0].name}", "123456").encoded,
            digester.digest("otp:${purposes[1].name}", "123456").encoded,
        )
    }

    @Test
    fun `cooldown and shared rate limit return authoritative retry after without sending mail`() {
        val cooling = fixture(MailDeliveryOutcome.DELIVERED)
        cooling.store.issueResult =
            ChallengeIssueResult.CoolingDown(
                VerificationChallengeId(UUID.randomUUID()),
                Duration.ofSeconds(41),
            )
        val limited = fixture(MailDeliveryOutcome.DELIVERED)
        limited.limiter.decision = RateLimitDecision.Rejected(Duration.ofSeconds(27))

        val coolingResult = cooling.service.requestCode(request(VerificationDeliveryEligibility.DELIVER))
        val limitedResult = limited.service.requestCode(request(VerificationDeliveryEligibility.DELIVER))

        assertEquals(Duration.ofSeconds(41), assertIs<RequestVerificationCodeResult.Accepted>(coolingResult).retryAfter)
        assertEquals(
            Duration.ofSeconds(27),
            assertIs<RequestVerificationCodeResult.RateLimited>(limitedResult).retryAfter,
        )
        assertEquals(0, cooling.mail.commands.size)
        assertEquals(0, limited.store.issued.size)
        assertEquals(0, limited.mail.commands.size)
    }

    @Test
    fun `definite mail failure invalidates challenge while unknown and timeout keep it usable`() {
        val definite = fixture(MailDeliveryOutcome.DEFINITE_FAILURE)
        val unknown = fixture(MailDeliveryOutcome.OUTCOME_UNKNOWN)
        val timeout = fixture(MailDeliveryOutcome.TIMEOUT)

        assertIs<RequestVerificationCodeResult.TemporarilyUnavailable>(
            definite.service.requestCode(request(VerificationDeliveryEligibility.DELIVER)),
        )
        assertIs<RequestVerificationCodeResult.Accepted>(
            unknown.service.requestCode(request(VerificationDeliveryEligibility.DELIVER)),
        )
        assertIs<RequestVerificationCodeResult.Accepted>(
            timeout.service.requestCode(request(VerificationDeliveryEligibility.DELIVER)),
        )
        assertEquals(ChallengeDeliveryState.FAILED, definite.store.deliveryState)
        assertEquals(ChallengeDeliveryState.OUTCOME_UNKNOWN, unknown.store.deliveryState)
        assertEquals(ChallengeDeliveryState.OUTCOME_UNKNOWN, timeout.store.deliveryState)
    }

    @Test
    fun `registration and reset verification issue purpose bound continuation but login returns subject`() {
        val subject = VerificationSubject(NORMALIZED_EMAIL, UserId(UUID.randomUUID()))
        val register = fixture(MailDeliveryOutcome.DELIVERED).apply { store.verificationSubject = subject }
        val reset = fixture(MailDeliveryOutcome.DELIVERED).apply { store.verificationSubject = subject }
        val login = fixture(MailDeliveryOutcome.DELIVERED).apply { store.verificationSubject = subject }

        val registerResult = register.service.verifyCode(verify(VerificationPurpose.REGISTER_EMAIL_VERIFY))
        val resetResult = reset.service.verifyCode(verify(VerificationPurpose.PASSWORD_RESET))
        val loginResult = login.service.verifyCode(verify(VerificationPurpose.LOGIN_EMAIL_OTP))

        assertEquals(
            VerificationPurpose.REGISTER_EMAIL_VERIFY,
            assertIs<VerifyCodeResult.ContinuationIssued>(registerResult).continuation.purpose,
        )
        assertEquals(
            VerificationPurpose.PASSWORD_RESET,
            assertIs<VerifyCodeResult.ContinuationIssued>(resetResult).continuation.purpose,
        )
        assertEquals(subject, assertIs<VerifyCodeResult.LoginVerified>(loginResult).subject)
        assertNull(login.store.lastVerify?.continuation)
    }

    @Test
    fun `verification preserves stable invalid exhausted and rate limited outcomes`() {
        val invalid =
            fixture(MailDeliveryOutcome.DELIVERED).apply {
                store.verificationResult = ChallengeVerificationResult.InvalidOrExpired
            }
        val exhausted =
            fixture(MailDeliveryOutcome.DELIVERED).apply {
                store.verificationResult = ChallengeVerificationResult.TooManyAttempts
            }
        val limited =
            fixture(MailDeliveryOutcome.DELIVERED).apply {
                limiter.decision = RateLimitDecision.Rejected(Duration.ofSeconds(12))
            }

        assertIs<VerifyCodeResult.InvalidOrExpired>(
            invalid.service.verifyCode(verify(VerificationPurpose.LOGIN_EMAIL_OTP)),
        )
        assertIs<VerifyCodeResult.TooManyAttempts>(
            exhausted.service.verifyCode(verify(VerificationPurpose.LOGIN_EMAIL_OTP)),
        )
        assertEquals(
            Duration.ofSeconds(12),
            assertIs<VerifyCodeResult.RateLimited>(
                limited.service.verifyCode(verify(VerificationPurpose.LOGIN_EMAIL_OTP)),
            ).retryAfter,
        )
    }

    private fun fixture(outcome: MailDeliveryOutcome): Fixture {
        val store = FakeVerificationStore()
        val rateStore = RecordingRateLimitStore()
        val mail = RecordingMailSender(outcome)
        val digester = digester()
        val policy = VerificationPolicy()
        return Fixture(
            service =
                VerificationChallengeService(
                    store = store,
                    security =
                        VerificationSecurityComponents(
                            requestRateLimiter =
                                VerificationRateLimiter(rateStore, digester, 3, Duration.ofMinutes(15)),
                            codeVerificationRateLimiter =
                                VerificationRateLimiter(rateStore, digester, 3, Duration.ofMinutes(15)),
                            codeGenerator = VerificationCodeGenerator { VerificationCode.fromUserInput("123456") },
                            continuationSecretGenerator =
                                ContinuationSecretGenerator { ContinuationSecret.fromMainInput("c".repeat(43)) },
                            challengeDigester = digester,
                            continuationDigester = digester,
                            policy = policy,
                        ),
                    mailSender = mail,
                    clock = Clock.fixed(NOW, ZoneOffset.UTC),
                ),
            store = store,
            limiter = rateStore,
            mail = mail,
        )
    }

    private fun request(
        eligibility: VerificationDeliveryEligibility,
        purpose: VerificationPurpose = VerificationPurpose.REGISTER_EMAIL_VERIFY,
    ) = RequestVerificationCodeCommand(
        email = EmailAddress(NORMALIZED_EMAIL, "Person@Example.com"),
        purpose = purpose,
        userId = null,
        deliveryEligibility = eligibility,
        signals = SIGNALS,
        correlationId = "correlation-1",
    )

    private fun verify(purpose: VerificationPurpose) =
        VerifyCodeCommand(
            challengeId = VerificationChallengeId(UUID.randomUUID()),
            purpose = purpose,
            normalizedEmail = NORMALIZED_EMAIL,
            code = VerificationCode.fromUserInput("123456"),
            signals = SIGNALS,
        )

    private fun digester(): SecretDigester = HmacSha256SecretDigester(ByteArray(32) { 7 })

    private fun templateFor(purpose: VerificationPurpose): VerificationMailTemplate =
        when (purpose) {
            VerificationPurpose.REGISTER_EMAIL_VERIFY -> VerificationMailTemplate.REGISTRATION_CODE
            VerificationPurpose.LOGIN_EMAIL_OTP -> VerificationMailTemplate.LOGIN_CODE
            VerificationPurpose.PASSWORD_RESET -> VerificationMailTemplate.PASSWORD_RESET_CODE
        }

    private data class Fixture(
        val service: VerificationChallengeService,
        val store: FakeVerificationStore,
        val limiter: RecordingRateLimitStore,
        val mail: RecordingMailSender,
    )

    private companion object {
        val NOW: Instant = Instant.parse("2026-09-30T10:00:00Z")
        const val NORMALIZED_EMAIL = "person@example.com"
        val SIGNALS = VerificationRequestSignals("203.0.113.0/24", "device-installation-1")
    }
}

private class RecordingRateLimitStore : RateLimitStore {
    val requests = mutableListOf<RateLimitRequest>()
    var decision: RateLimitDecision = RateLimitDecision.Allowed

    override fun acquire(request: RateLimitRequest): RateLimitDecision {
        requests += request
        return decision
    }
}

private class RecordingMailSender(
    private val outcome: MailDeliveryOutcome,
) : VerificationMailSender {
    val commands = mutableListOf<VerificationMailCommand>()

    override fun send(command: VerificationMailCommand): MailDeliveryResult {
        commands += command
        return MailDeliveryResult(outcome, "provider-message-1")
    }
}

private class FakeVerificationStore : VerificationStore {
    val issued = mutableListOf<NewVerificationChallenge>()
    var issueResult: ChallengeIssueResult = ChallengeIssueResult.Created
    var deliveryState: ChallengeDeliveryState? = null
    var verificationSubject = VerificationSubject("person@example.com", null)
    var verificationResult: ChallengeVerificationResult? = null
    var lastVerify: VerifyChallengeCommand? = null

    override fun issue(challenge: NewVerificationChallenge): ChallengeIssueResult {
        issued += challenge
        return issueResult
    }

    override fun recordDelivery(
        challengeId: VerificationChallengeId,
        state: ChallengeDeliveryState,
        recordedAt: Instant,
    ) {
        deliveryState = state
    }

    override fun verify(command: VerifyChallengeCommand): ChallengeVerificationResult {
        lastVerify = command
        return verificationResult ?: ChallengeVerificationResult.Verified(verificationSubject)
    }

    override fun consumeContinuation(command: ConsumeContinuationCommand): ContinuationConsumptionResult =
        ContinuationConsumptionResult.Consumed(verificationSubject)
}
