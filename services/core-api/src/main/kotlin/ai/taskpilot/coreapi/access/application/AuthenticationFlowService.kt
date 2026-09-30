package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.AuthContinuationId
import ai.taskpilot.coreapi.access.model.ContinuationSecret
import ai.taskpilot.coreapi.access.model.VerificationChallengeId
import ai.taskpilot.coreapi.access.model.VerificationCode
import ai.taskpilot.coreapi.access.model.VerificationPurpose
import java.time.Instant
import java.util.UUID

data class VerificationRequestContext(
    val sourceNetwork: String,
    val deviceInstallationId: String,
    val correlationId: String,
)

data class AcceptedCodeRequest(
    val challengeId: UUID,
    val retryAfterSeconds: Long,
)

data class IssuedFlowContinuation(
    val continuationId: UUID,
    val continuationSecret: String,
    val expiresAt: Instant,
)

sealed interface CodeRequestOutcome {
    data class Accepted(
        val value: AcceptedCodeRequest,
    ) : CodeRequestOutcome

    data class RateLimited(
        val retryAfterSeconds: Long,
    ) : CodeRequestOutcome

    data object TemporarilyUnavailable : CodeRequestOutcome
}

sealed interface CodeVerificationOutcome {
    data class Continuation(
        val value: IssuedFlowContinuation,
    ) : CodeVerificationOutcome

    data class Session(
        val value: IssuedSession,
    ) : CodeVerificationOutcome

    data object InvalidOrExpired : CodeVerificationOutcome

    data object TooManyAttempts : CodeVerificationOutcome

    data class RateLimited(
        val retryAfterSeconds: Long,
    ) : CodeVerificationOutcome
}

interface AuthenticationFlowService {
    fun requestCode(
        rawEmail: String,
        purpose: VerificationPurpose,
        context: VerificationRequestContext,
    ): CodeRequestOutcome

    fun verifyCode(
        challengeId: UUID,
        rawEmail: String,
        rawCode: String,
        purpose: VerificationPurpose,
        context: VerificationRequestContext,
    ): CodeVerificationOutcome

    @Suppress("LongParameterList") // Mirrors the frozen registration HTTP command fields.
    fun register(
        continuationId: UUID,
        continuationSecret: String,
        rawEmail: String,
        displayName: String,
        password: CharSequence,
        termsVersion: String,
    ): RegistrationResult

    fun loginWithPassword(
        rawEmail: String,
        password: CharSequence,
    ): AuthenticationResult

    fun resetPassword(
        continuationId: UUID,
        continuationSecret: String,
        rawEmail: String,
        newPassword: CharSequence,
    ): PasswordResetResult
}

internal fun issuedContinuationView(
    continuationId: AuthContinuationId,
    secret: ContinuationSecret,
    expiresAt: Instant,
): IssuedFlowContinuation = IssuedFlowContinuation(continuationId.value, secret.value, expiresAt)

internal fun verificationSignals(context: VerificationRequestContext): VerificationRequestSignals =
    VerificationRequestSignals(context.sourceNetwork, context.deviceInstallationId)

internal fun verificationChallengeId(id: UUID): VerificationChallengeId = VerificationChallengeId(id)

internal fun verificationCode(value: String): VerificationCode = VerificationCode.fromUserInput(value)
