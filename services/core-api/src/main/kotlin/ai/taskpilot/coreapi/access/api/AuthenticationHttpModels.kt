package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.IssuedFlowContinuation
import ai.taskpilot.coreapi.access.application.IssuedSession
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import java.time.Instant
import java.util.UUID

data class EmailCodeRequest(
    @field:NotBlank @field:Email @field:Size(max = 254) val email: String,
    @field:NotBlank @field:Size(max = 128) val deviceInstallationId: String,
)

data class VerifyEmailCodeRequest(
    val challengeId: UUID,
    @field:NotBlank @field:Email @field:Size(max = 254) val email: String,
    @field:Pattern(regexp = "[0-9]{6}") val code: String,
    @field:NotBlank @field:Size(max = 128) val deviceInstallationId: String,
)

data class RegistrationRequest(
    val continuationId: UUID,
    @field:NotBlank @field:Size(max = 512) val continuationSecret: String,
    @field:NotBlank @field:Email @field:Size(max = 254) val email: String,
    @field:NotBlank @field:Size(max = 200) val displayName: String,
    @field:NotBlank @field:Size(max = 512) val password: String,
    @field:NotBlank @field:Size(max = 128) val termsVersion: String,
)

data class PasswordLoginRequest(
    @field:NotBlank @field:Email @field:Size(max = 254) val email: String,
    @field:NotBlank @field:Size(max = 512) val password: String,
)

data class PasswordResetRequest(
    val continuationId: UUID,
    @field:NotBlank @field:Size(max = 512) val continuationSecret: String,
    @field:NotBlank @field:Email @field:Size(max = 254) val email: String,
    @field:NotBlank @field:Size(max = 512) val newPassword: String,
)

data class RefreshRequest(
    @field:NotBlank @field:Size(max = 512) val refreshToken: String,
    val refreshRequestId: UUID,
)

data class CodeAcceptedResponse(
    val challengeId: UUID,
    val retryAfterSeconds: Long,
)

data class ContinuationResponse(
    val continuationId: UUID,
    val continuationSecret: String,
    val expiresAt: Instant,
) {
    companion object {
        fun from(value: IssuedFlowContinuation) =
            ContinuationResponse(
                value.continuationId,
                value.continuationSecret,
                value.expiresAt,
            )
    }
}

data class CurrentUserResponse(
    val userId: UUID,
    val displayName: String,
    val email: String,
) {
    companion object {
        fun from(view: CurrentUserView) = CurrentUserResponse(view.userId.value, view.displayName, view.email)
    }
}

data class SessionResponse(
    val accessToken: String,
    val accessTokenExpiresAt: Instant,
    val refreshToken: String,
    val refreshTokenExpiresAt: Instant,
    val currentUser: CurrentUserResponse,
) {
    companion object {
        fun from(session: IssuedSession) =
            SessionResponse(
                session.accessToken,
                session.accessTokenExpiresAt,
                session.refreshToken,
                session.refreshTokenExpiresAt,
                CurrentUserResponse.from(session.currentUser),
            )
    }
}
