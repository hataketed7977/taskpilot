package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.SessionUseCases
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
class AuthenticationController(
    private val sessions: SessionUseCases,
) {
    @PostMapping("/auth/session/refresh")
    fun refresh(
        @Valid @RequestBody body: RefreshRequest,
    ): SessionResponse =
        when (val result = sessions.refresh(body.refreshToken)) {
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

    @GetMapping("/me")
    fun currentUser(
        @AuthenticationPrincipal principal: DesktopPrincipal,
    ): CurrentUserResponse = principal.user

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

    private fun <T> fail(
        status: HttpStatus,
        code: String,
    ): T = throw AuthenticationProblemException(status, code)
}

private const val BEARER_PREFIX = "Bearer "
private const val MAXIMUM_BEARER_TOKEN_LENGTH = 512
