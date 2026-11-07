package ai.taskpilot.coreapi.access.api

import ai.taskpilot.contract.generated.api.SessionApi
import ai.taskpilot.contract.generated.model.CurrentUserResponse
import ai.taskpilot.contract.generated.model.RefreshRequest
import ai.taskpilot.contract.generated.model.SessionResponse
import ai.taskpilot.coreapi.AuthenticationProblemException
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.currentAuthenticatedActor
import ai.taskpilot.coreapi.currentHttpRequest
import jakarta.servlet.http.HttpServletRequest
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController

@RestController
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class AuthenticationController(
    private val sessions: SessionUseCases,
) : SessionApi {
    override fun refresh(refreshRequest: RefreshRequest): ResponseEntity<SessionResponse> {
        AuthenticationWireInputPolicy.refreshToken(refreshRequest.refreshToken)
        return when (val result = sessions.refresh(refreshRequest.refreshToken)) {
            is RefreshSessionResult.Refreshed -> ResponseEntity.ok(result.session.toWireResponse())
            RefreshSessionResult.AuthenticationRequired -> fail(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED")
        }
    }

    override fun logout(): ResponseEntity<Unit> {
        val accessToken =
            currentHttpRequest().strictBearerToken()
                ?: fail(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED")
        sessions.logout(accessToken)
        return ResponseEntity.noContent().build()
    }

    override fun currentUser(): ResponseEntity<CurrentUserResponse> {
        val principal =
            currentAuthenticatedActor() as? DesktopPrincipal
                ?: fail(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED")
        return ResponseEntity.ok(principal.user)
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

    private fun <T> fail(
        status: HttpStatus,
        code: String,
    ): T = throw AuthenticationProblemException(status, code)
}

private const val BEARER_PREFIX = "Bearer "
private const val MAXIMUM_BEARER_TOKEN_LENGTH = 512
