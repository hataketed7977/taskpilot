package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.access.AuthenticatedActor
import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.SessionUseCases
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.MediaType
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.filter.OncePerRequestFilter
import java.util.UUID

data class DesktopPrincipal(
    val accessToken: String,
    val user: CurrentUserResponse,
) : AuthenticatedActor {
    override val userId: UUID get() = user.userId
}

class DesktopBearerAuthenticationFilter(
    private val sessions: SessionUseCases,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val bearer =
            request
                .getHeader("Authorization")
                ?.takeIf { it.startsWith(BEARER_PREFIX) }
                ?.substring(BEARER_PREFIX.length)
        if (!bearer.isNullOrBlank()) {
            val current = sessions.currentUser(bearer)
            if (current is CurrentUserResult.Authenticated) {
                val principal = DesktopPrincipal(bearer, CurrentUserResponse.from(current.currentUser))
                SecurityContextHolder.getContext().authentication =
                    UsernamePasswordAuthenticationToken.authenticated(principal, null, emptyList())
            }
        }
        filterChain.doFilter(request, response)
    }
}

class DesktopRequestGuardFilter(
    private val maximumBodyBytes: Long = DEFAULT_MAXIMUM_BODY_BYTES,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val correlationId =
            request.getHeader("X-Correlation-Id")?.takeIf(::isSafeCorrelationId)
                ?: UUID.randomUUID().toString()
        request.setAttribute(CORRELATION_ID_ATTRIBUTE, correlationId)
        response.setHeader("X-Correlation-Id", correlationId)
        if (request.contentLengthLong > maximumBodyBytes) {
            response.status = HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE
            response.contentType = MediaType.APPLICATION_PROBLEM_JSON_VALUE
            response.writer.write(
                "{\"type\":\"https://taskpilot.ai/problems/request-too-large\",\"title\":\"Payload Too Large\"," +
                    "\"status\":413,\"code\":\"REQUEST_TOO_LARGE\",\"correlationId\":\"$correlationId\"}",
            )
            return
        }
        filterChain.doFilter(request, response)
    }

    private fun isSafeCorrelationId(value: String): Boolean =
        value.length in 1..MAXIMUM_CORRELATION_ID_LENGTH &&
            value.all { it.isLetterOrDigit() || it in "-_.:" }
}

private const val BEARER_PREFIX = "Bearer "
private const val DEFAULT_MAXIMUM_BODY_BYTES = 16_384L
private const val MAXIMUM_CORRELATION_ID_LENGTH = 128
