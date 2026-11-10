package ai.taskpilot.coreapi.access.api

import ai.taskpilot.contract.generated.api.SessionApi
import ai.taskpilot.contract.generated.model.CurrentUserResponse
import ai.taskpilot.contract.generated.model.LogoutRequest
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
import tools.jackson.databind.DeserializationFeature
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.json.JsonMapper

@RestController
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class AuthenticationController(
    private val sessions: SessionUseCases,
    private val objectMapper: ObjectMapper = JsonMapper.builder().build(),
) : SessionApi {
    override fun refresh(refreshRequest: RefreshRequest): ResponseEntity<SessionResponse> {
        AuthenticationWireInputPolicy.refreshToken(refreshRequest.refreshToken)
        return when (val result = sessions.refresh(refreshRequest.refreshToken)) {
            is RefreshSessionResult.Refreshed -> ResponseEntity.ok(result.session.toWireResponse())
            RefreshSessionResult.AuthenticationRequired -> fail(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED")
        }
    }

    override fun logout(logoutRequest: LogoutRequest?): ResponseEntity<Unit> {
        val request = currentHttpRequest()
        validateLogoutBody(request)
        val refreshToken = logoutRequest?.refreshToken
        if (refreshToken != null) {
            val length = refreshToken.codePointCount(0, refreshToken.length)
            if (request.getHeader("Authorization") != null || length !in 1..MAXIMUM_BEARER_TOKEN_LENGTH) {
                fail<Unit>(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED")
            }
            sessions.logoutByRefreshToken(refreshToken)
        } else {
            val accessToken = request.strictBearerToken() ?: fail(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED")
            sessions.logout(accessToken)
        }
        return ResponseEntity.noContent().build()
    }

    private fun validateLogoutBody(request: HttpServletRequest) {
        val body = request.inputStream.readAllBytes()
        if (body.isEmpty()) return
        val node =
            objectMapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body)
        val valid =
            node != null && node.isObject &&
                (node.isEmpty || (node.size() == 1 && node.has("refreshToken") && node.get("refreshToken").isString))
        if (!valid) fail<Unit>(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED")
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
