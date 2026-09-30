package ai.taskpilot.coreapi.access.persistence

import ai.taskpilot.coreapi.access.application.AcceptedCodeRequest
import ai.taskpilot.coreapi.access.application.AuthenticationFlowService
import ai.taskpilot.coreapi.access.application.AuthenticationResult
import ai.taskpilot.coreapi.access.application.AuthenticationUseCases
import ai.taskpilot.coreapi.access.application.CodeRequestOutcome
import ai.taskpilot.coreapi.access.application.CodeVerificationOutcome
import ai.taskpilot.coreapi.access.application.EmailAddressNormalizer
import ai.taskpilot.coreapi.access.application.EmailCodeLoginCommand
import ai.taskpilot.coreapi.access.application.PasswordLoginCommand
import ai.taskpilot.coreapi.access.application.PasswordResetCommand
import ai.taskpilot.coreapi.access.application.PasswordResetResult
import ai.taskpilot.coreapi.access.application.RateLimitDecision
import ai.taskpilot.coreapi.access.application.RegistrationCommand
import ai.taskpilot.coreapi.access.application.RegistrationResult
import ai.taskpilot.coreapi.access.application.RequestVerificationCodeCommand
import ai.taskpilot.coreapi.access.application.RequestVerificationCodeResult
import ai.taskpilot.coreapi.access.application.VerificationChallengeService
import ai.taskpilot.coreapi.access.application.VerificationDeliveryEligibility
import ai.taskpilot.coreapi.access.application.VerificationRequestContext
import ai.taskpilot.coreapi.access.application.VerifyCodeCommand
import ai.taskpilot.coreapi.access.application.VerifyCodeResult
import ai.taskpilot.coreapi.access.application.issuedContinuationView
import ai.taskpilot.coreapi.access.application.verificationChallengeId
import ai.taskpilot.coreapi.access.application.verificationCode
import ai.taskpilot.coreapi.access.application.verificationSignals
import ai.taskpilot.coreapi.access.model.AuthContinuationId
import ai.taskpilot.coreapi.access.model.ContinuationSecret
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.VerificationPurpose
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID
import javax.sql.DataSource

class JdbcAuthenticationFlowService(
    dataSource: DataSource,
    private val normalizer: EmailAddressNormalizer,
    private val verification: VerificationChallengeService,
    private val authentication: AuthenticationUseCases,
) : AuthenticationFlowService {
    private val jdbc = JdbcTemplate(dataSource)

    override fun requestCode(
        rawEmail: String,
        purpose: VerificationPurpose,
        context: VerificationRequestContext,
    ): CodeRequestOutcome {
        val email = normalizer.normalize(rawEmail)
        val userId = findActiveUserId(email.normalized)
        val eligible =
            when (purpose) {
                VerificationPurpose.REGISTER_EMAIL_VERIFY -> userId == null
                VerificationPurpose.LOGIN_EMAIL_OTP, VerificationPurpose.PASSWORD_RESET -> userId != null
            }
        val result =
            verification.requestCode(
                RequestVerificationCodeCommand(
                    email = email,
                    purpose = purpose,
                    userId = if (purpose == VerificationPurpose.REGISTER_EMAIL_VERIFY) null else userId,
                    deliveryEligibility =
                        if (eligible) {
                            VerificationDeliveryEligibility.DELIVER
                        } else {
                            VerificationDeliveryEligibility.SUPPRESS
                        },
                    signals = verificationSignals(context),
                    correlationId = context.correlationId,
                ),
            )
        return when (result) {
            is RequestVerificationCodeResult.Accepted -> {
                CodeRequestOutcome.Accepted(
                    AcceptedCodeRequest(result.challengeId.value, result.retryAfter.seconds.coerceAtLeast(0)),
                )
            }

            is RequestVerificationCodeResult.RateLimited -> {
                CodeRequestOutcome.RateLimited(result.retryAfter.seconds.coerceAtLeast(0))
            }

            RequestVerificationCodeResult.TemporarilyUnavailable -> {
                CodeRequestOutcome.TemporarilyUnavailable
            }
        }
    }

    // Coordinates two distinct verification owners while keeping the public flow atomic.
    @Suppress("LongMethod", "ReturnCount")
    override fun verifyCode(
        challengeId: UUID,
        rawEmail: String,
        rawCode: String,
        purpose: VerificationPurpose,
        context: VerificationRequestContext,
    ): CodeVerificationOutcome {
        val email = normalizer.normalize(rawEmail)
        val id = verificationChallengeId(challengeId)
        val code = verificationCode(rawCode)
        if (purpose == VerificationPurpose.LOGIN_EMAIL_OTP) {
            when (
                val rateLimit =
                    verification.acquireVerificationRateLimit(
                        purpose,
                        email.normalized,
                        verificationSignals(context),
                    )
            ) {
                RateLimitDecision.Allowed -> {
                    Unit
                }

                is RateLimitDecision.Rejected -> {
                    return CodeVerificationOutcome.RateLimited(rateLimit.retryAfter.seconds.coerceAtLeast(0))
                }
            }
            return when (
                val result =
                    authentication.loginWithEmailCode(
                        EmailCodeLoginCommand(id, email, code),
                    )
            ) {
                is AuthenticationResult.Authenticated -> CodeVerificationOutcome.Session(result.session)

                AuthenticationResult.InvalidCredentials,
                AuthenticationResult.InvalidOrExpiredCode,
                -> CodeVerificationOutcome.InvalidOrExpired
            }
        }
        return when (
            val result =
                verification.verifyCode(
                    VerifyCodeCommand(id, purpose, email.normalized, code, verificationSignals(context)),
                )
        ) {
            is VerifyCodeResult.ContinuationIssued -> {
                CodeVerificationOutcome.Continuation(
                    issuedContinuationView(
                        result.continuation.continuationId,
                        result.continuation.secret,
                        result.continuation.expiresAt,
                    ),
                )
            }

            is VerifyCodeResult.RateLimited -> {
                CodeVerificationOutcome.RateLimited(result.retryAfter.seconds.coerceAtLeast(0))
            }

            VerifyCodeResult.InvalidOrExpired -> {
                CodeVerificationOutcome.InvalidOrExpired
            }

            VerifyCodeResult.TooManyAttempts -> {
                CodeVerificationOutcome.TooManyAttempts
            }

            is VerifyCodeResult.LoginVerified -> {
                error("Login verification must be owned by the atomic login use case")
            }
        }
    }

    override fun register(
        continuationId: UUID,
        continuationSecret: String,
        rawEmail: String,
        displayName: String,
        password: CharSequence,
        termsVersion: String,
    ): RegistrationResult =
        authentication.register(
            RegistrationCommand(
                AuthContinuationId(continuationId),
                ContinuationSecret.fromMainInput(continuationSecret),
                normalizer.normalize(rawEmail),
                displayName,
                password,
                termsVersion,
            ),
        )

    override fun loginWithPassword(
        rawEmail: String,
        password: CharSequence,
    ): AuthenticationResult =
        authentication.loginWithPassword(
            PasswordLoginCommand(normalizer.normalize(rawEmail), password),
        )

    override fun resetPassword(
        continuationId: UUID,
        continuationSecret: String,
        rawEmail: String,
        newPassword: CharSequence,
    ): PasswordResetResult =
        authentication.resetPassword(
            PasswordResetCommand(
                AuthContinuationId(continuationId),
                ContinuationSecret.fromMainInput(continuationSecret),
                normalizer.normalize(rawEmail),
                newPassword,
            ),
        )

    private fun findActiveUserId(normalizedEmail: String): UserId? =
        jdbc
            .query(
                """
                SELECT u.user_id
                FROM app_users u
                JOIN email_identities e ON e.user_id = u.user_id
                WHERE e.normalized_email = ? AND u.status = 'ACTIVE'
                """.trimIndent(),
                { rows, _ -> UserId(rows.getObject("user_id", UUID::class.java)) },
                normalizedEmail,
            ).singleOrNull()
}
