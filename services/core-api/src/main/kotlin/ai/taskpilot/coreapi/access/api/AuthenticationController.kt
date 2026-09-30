package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.access.application.AuthenticationFlowService
import ai.taskpilot.coreapi.access.application.AuthenticationResult
import ai.taskpilot.coreapi.access.application.CodeRequestOutcome
import ai.taskpilot.coreapi.access.application.CodeVerificationOutcome
import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.PasswordResetResult
import ai.taskpilot.coreapi.access.application.RefreshSessionCommand
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.RegistrationResult
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.access.application.VerificationRequestContext
import ai.taskpilot.coreapi.access.model.VerificationPurpose
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/desktop/v1")
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
// Endpoints share one strict transport/error mapping boundary.
@Suppress("TooManyFunctions")
class AuthenticationController(
    private val flows: AuthenticationFlowService,
    private val sessions: SessionUseCases,
) {
    @PostMapping("/auth/registration/code")
    fun requestRegistrationCode(
        @Valid @RequestBody body: EmailCodeRequest,
        request: HttpServletRequest,
    ): ResponseEntity<CodeAcceptedResponse> = requestCode(body, VerificationPurpose.REGISTER_EMAIL_VERIFY, request)

    @PostMapping("/auth/registration/code/verify")
    fun verifyRegistrationCode(
        @Valid @RequestBody body: VerifyEmailCodeRequest,
        request: HttpServletRequest,
    ): ContinuationResponse = verifyContinuation(body, VerificationPurpose.REGISTER_EMAIL_VERIFY, request)

    @PostMapping("/auth/registration")
    fun register(
        @Valid @RequestBody body: RegistrationRequest,
    ): ResponseEntity<SessionResponse> =
        when (
            val result =
                flows.register(
                    body.continuationId,
                    body.continuationSecret,
                    body.email,
                    body.displayName,
                    body.password,
                    body.termsVersion,
                )
        ) {
            is RegistrationResult.Registered -> {
                ResponseEntity.status(HttpStatus.CREATED).body(SessionResponse.from(result.session))
            }

            RegistrationResult.ContextExpired -> {
                fail(HttpStatus.CONFLICT, "REGISTRATION_CONTEXT_EXPIRED")
            }

            RegistrationResult.EmailAlreadyRegistered -> {
                fail(HttpStatus.CONFLICT, "EMAIL_ALREADY_REGISTERED")
            }

            RegistrationResult.TermsVersionRejected -> {
                fail(HttpStatus.CONFLICT, "TERMS_VERSION_REJECTED", "termsVersion")
            }
        }

    @PostMapping("/auth/login/password")
    fun loginWithPassword(
        @Valid @RequestBody body: PasswordLoginRequest,
    ): SessionResponse =
        when (val result = flows.loginWithPassword(body.email, body.password)) {
            is AuthenticationResult.Authenticated -> SessionResponse.from(result.session)

            AuthenticationResult.InvalidCredentials,
            AuthenticationResult.InvalidOrExpiredCode,
            -> fail(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS")
        }

    @PostMapping("/auth/login/code")
    fun requestLoginCode(
        @Valid @RequestBody body: EmailCodeRequest,
        request: HttpServletRequest,
    ): ResponseEntity<CodeAcceptedResponse> = requestCode(body, VerificationPurpose.LOGIN_EMAIL_OTP, request)

    @PostMapping("/auth/login/code/verify")
    fun verifyLoginCode(
        @Valid @RequestBody body: VerifyEmailCodeRequest,
        request: HttpServletRequest,
    ): SessionResponse =
        when (
            val result =
                flows.verifyCode(
                    body.challengeId,
                    body.email,
                    body.code,
                    VerificationPurpose.LOGIN_EMAIL_OTP,
                    request.context(body.deviceInstallationId),
                )
        ) {
            is CodeVerificationOutcome.Session -> SessionResponse.from(result.value)

            is CodeVerificationOutcome.RateLimited -> failRateLimited(result.retryAfterSeconds)

            CodeVerificationOutcome.InvalidOrExpired,
            CodeVerificationOutcome.TooManyAttempts,
            -> fail(HttpStatus.UNAUTHORIZED, "INVALID_OR_EXPIRED_CODE")

            is CodeVerificationOutcome.Continuation -> error("Login code cannot issue a continuation")
        }

    @PostMapping("/auth/password-reset/code")
    fun requestPasswordResetCode(
        @Valid @RequestBody body: EmailCodeRequest,
        request: HttpServletRequest,
    ): ResponseEntity<CodeAcceptedResponse> = requestCode(body, VerificationPurpose.PASSWORD_RESET, request)

    @PostMapping("/auth/password-reset/code/verify")
    fun verifyPasswordResetCode(
        @Valid @RequestBody body: VerifyEmailCodeRequest,
        request: HttpServletRequest,
    ): ContinuationResponse = verifyContinuation(body, VerificationPurpose.PASSWORD_RESET, request)

    @PostMapping("/auth/password-reset")
    fun resetPassword(
        @Valid @RequestBody body: PasswordResetRequest,
    ): ResponseEntity<Void> =
        when (
            flows.resetPassword(
                body.continuationId,
                body.continuationSecret,
                body.email,
                body.newPassword,
            )
        ) {
            PasswordResetResult.PASSWORD_UPDATED -> ResponseEntity.noContent().build()
            PasswordResetResult.CONTEXT_EXPIRED -> fail(HttpStatus.CONFLICT, "PASSWORD_RESET_CONTEXT_EXPIRED")
        }

    @PostMapping("/auth/session/refresh")
    fun refresh(
        @Valid @RequestBody body: RefreshRequest,
    ): SessionResponse =
        when (val result = sessions.refresh(RefreshSessionCommand(body.refreshToken, body.refreshRequestId))) {
            is RefreshSessionResult.Refreshed -> SessionResponse.from(result.session)
            RefreshSessionResult.AuthenticationRequired -> fail(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED")
        }

    @PostMapping("/auth/session/logout")
    fun logout(request: HttpServletRequest): ResponseEntity<Void> {
        val accessToken =
            request.strictBearerToken()
                ?: fail(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED")
        sessions.logout(accessToken)
        return ResponseEntity.noContent().build()
    }

    @Suppress("ReturnCount") // Each malformed bearer shape must fail closed immediately.
    private fun HttpServletRequest.strictBearerToken(): String? {
        val authorization = getHeader("Authorization") ?: return null
        val malformed =
            !authorization.startsWith(BEARER_PREFIX) ||
                authorization.indexOf(' ', BEARER_PREFIX.length) >= 0
        if (malformed) return null
        return authorization
            .substring(BEARER_PREFIX.length)
            .takeIf { it.isNotBlank() && it.length <= MAXIMUM_BEARER_TOKEN_LENGTH }
    }

    @GetMapping("/me")
    fun currentUser(
        @AuthenticationPrincipal principal: DesktopPrincipal,
    ): CurrentUserResponse = principal.user

    private fun requestCode(
        body: EmailCodeRequest,
        purpose: VerificationPurpose,
        request: HttpServletRequest,
    ): ResponseEntity<CodeAcceptedResponse> =
        when (val result = flows.requestCode(body.email, purpose, request.context(body.deviceInstallationId))) {
            is CodeRequestOutcome.Accepted -> {
                ResponseEntity.accepted().body(
                    CodeAcceptedResponse(result.value.challengeId, result.value.retryAfterSeconds),
                )
            }

            is CodeRequestOutcome.RateLimited -> {
                failRateLimited(result.retryAfterSeconds)
            }

            CodeRequestOutcome.TemporarilyUnavailable -> {
                fail(HttpStatus.SERVICE_UNAVAILABLE, "AUTHENTICATION_TEMPORARILY_UNAVAILABLE")
            }
        }

    private fun verifyContinuation(
        body: VerifyEmailCodeRequest,
        purpose: VerificationPurpose,
        request: HttpServletRequest,
    ): ContinuationResponse =
        when (
            val result =
                flows.verifyCode(
                    body.challengeId,
                    body.email,
                    body.code,
                    purpose,
                    request.context(body.deviceInstallationId),
                )
        ) {
            is CodeVerificationOutcome.Continuation -> ContinuationResponse.from(result.value)

            is CodeVerificationOutcome.RateLimited -> failRateLimited(result.retryAfterSeconds)

            CodeVerificationOutcome.InvalidOrExpired,
            CodeVerificationOutcome.TooManyAttempts,
            -> fail(HttpStatus.UNAUTHORIZED, "INVALID_OR_EXPIRED_CODE")

            is CodeVerificationOutcome.Session -> error("Continuation verification cannot create a session")
        }

    private fun HttpServletRequest.context(deviceInstallationId: String): VerificationRequestContext =
        VerificationRequestContext(
            sourceNetwork = remoteAddr,
            deviceInstallationId = deviceInstallationId,
            correlationId = getAttribute(CORRELATION_ID_ATTRIBUTE).toString(),
        )

    private fun failRateLimited(retryAfterSeconds: Long): Nothing =
        fail(HttpStatus.TOO_MANY_REQUESTS, "AUTHENTICATION_RATE_LIMITED", retryAfterSeconds = retryAfterSeconds)

    private fun <T> fail(
        status: HttpStatus,
        code: String,
        path: String? = null,
        retryAfterSeconds: Long? = null,
    ): T = throw AuthenticationProblemException(status, code, path, retryAfterSeconds)
}

private const val BEARER_PREFIX = "Bearer "
private const val MAXIMUM_BEARER_TOKEN_LENGTH = 512
