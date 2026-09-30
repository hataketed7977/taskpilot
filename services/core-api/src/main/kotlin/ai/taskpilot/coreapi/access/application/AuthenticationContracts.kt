package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.AuthContinuationId
import ai.taskpilot.coreapi.access.model.ContinuationSecret
import ai.taskpilot.coreapi.access.model.EmailAddress
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.VerificationChallengeId
import ai.taskpilot.coreapi.access.model.VerificationCode
import java.time.Instant
import java.util.UUID

@JvmInline
value class SessionId(
    val value: UUID,
)

@JvmInline
value class SessionFamilyId(
    val value: UUID,
)

data class CurrentUserView(
    val userId: UserId,
    val displayName: String,
    val email: String,
)

data class IssuedSession(
    val sessionId: SessionId,
    val familyId: SessionFamilyId,
    val accessToken: String,
    val accessTokenExpiresAt: Instant,
    val refreshToken: String,
    val refreshTokenExpiresAt: Instant,
    val currentUser: CurrentUserView,
) {
    override fun toString(): String =
        "IssuedSession(sessionId=[REDACTED], familyId=[REDACTED], accessToken=[REDACTED], " +
            "accessTokenExpiresAt=$accessTokenExpiresAt, refreshToken=[REDACTED], " +
            "refreshTokenExpiresAt=$refreshTokenExpiresAt, currentUser=$currentUser)"
}

data class RegistrationCommand(
    val continuationId: AuthContinuationId,
    val continuationSecret: ContinuationSecret,
    val email: EmailAddress,
    val displayName: String,
    val password: CharSequence,
    val termsVersion: String,
)

sealed interface RegistrationResult {
    data class Registered(
        val session: IssuedSession,
    ) : RegistrationResult

    data object ContextExpired : RegistrationResult

    data object EmailAlreadyRegistered : RegistrationResult

    data object TermsVersionRejected : RegistrationResult
}

data class PasswordLoginCommand(
    val email: EmailAddress,
    val password: CharSequence,
)

data class EmailCodeLoginCommand(
    val challengeId: VerificationChallengeId,
    val email: EmailAddress,
    val code: VerificationCode,
)

sealed interface AuthenticationResult {
    data class Authenticated(
        val session: IssuedSession,
    ) : AuthenticationResult

    data object InvalidCredentials : AuthenticationResult

    data object InvalidOrExpiredCode : AuthenticationResult
}

data class PasswordResetCommand(
    val continuationId: AuthContinuationId,
    val continuationSecret: ContinuationSecret,
    val email: EmailAddress,
    val newPassword: CharSequence,
)

enum class PasswordResetResult {
    PASSWORD_UPDATED,
    CONTEXT_EXPIRED,
}

interface AuthenticationUseCases {
    fun register(command: RegistrationCommand): RegistrationResult

    fun loginWithPassword(command: PasswordLoginCommand): AuthenticationResult

    fun loginWithEmailCode(command: EmailCodeLoginCommand): AuthenticationResult

    fun resetPassword(command: PasswordResetCommand): PasswordResetResult
}
