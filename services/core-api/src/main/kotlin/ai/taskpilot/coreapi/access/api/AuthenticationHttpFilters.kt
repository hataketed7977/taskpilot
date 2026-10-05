package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.access.AuthenticatedActor
import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.SessionUseCases
import jakarta.servlet.FilterChain
import jakarta.servlet.ReadListener
import jakarta.servlet.ServletInputStream
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.MediaType
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.filter.OncePerRequestFilter
import java.io.BufferedReader
import java.io.ByteArrayInputStream
import java.io.InputStreamReader
import java.nio.charset.Charset
import java.nio.charset.StandardCharsets
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
            writePayloadTooLarge(response, correlationId)
            return
        }
        val body = request.inputStream.readNBytes((maximumBodyBytes + 1).toInt())
        if (body.size > maximumBodyBytes) {
            writePayloadTooLarge(response, correlationId)
            return
        }
        filterChain.doFilter(CachedBodyRequest(request, body), response)
    }

    init {
        require(maximumBodyBytes in 0 until Int.MAX_VALUE.toLong())
    }

    private fun writePayloadTooLarge(
        response: HttpServletResponse,
        correlationId: String,
    ) {
        response.status = HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE
        response.contentType = MediaType.APPLICATION_PROBLEM_JSON_VALUE
        response.writer.write(
            "{\"type\":\"https://taskpilot.ai/problems/request-too-large\",\"title\":\"Payload Too Large\"," +
                "\"status\":413,\"code\":\"REQUEST_TOO_LARGE\",\"correlationId\":\"$correlationId\"}",
        )
    }

    private fun isSafeCorrelationId(value: String): Boolean =
        value.length in 1..MAXIMUM_CORRELATION_ID_LENGTH &&
            value.all { it.isLetterOrDigit() || it in "-_.:" }
}

private class CachedBodyRequest(
    request: HttpServletRequest,
    private val body: ByteArray,
) : HttpServletRequestWrapper(request) {
    override fun getContentLength(): Int = body.size

    override fun getContentLengthLong(): Long = body.size.toLong()

    override fun getInputStream(): ServletInputStream =
        object : ServletInputStream() {
            private val input = ByteArrayInputStream(body)

            override fun read(): Int = input.read()

            override fun read(
                buffer: ByteArray,
                offset: Int,
                length: Int,
            ): Int = input.read(buffer, offset, length)

            override fun isFinished(): Boolean = input.available() == 0

            override fun isReady(): Boolean = true

            override fun setReadListener(readListener: ReadListener) {
                if (isFinished) readListener.onAllDataRead() else readListener.onDataAvailable()
            }
        }

    override fun getReader(): BufferedReader {
        val charset = characterEncoding?.let(Charset::forName) ?: StandardCharsets.UTF_8
        return BufferedReader(InputStreamReader(inputStream, charset))
    }
}

private const val BEARER_PREFIX = "Bearer "
private const val DEFAULT_MAXIMUM_BODY_BYTES = 16_384L
private const val MAXIMUM_CORRELATION_ID_LENGTH = 128
