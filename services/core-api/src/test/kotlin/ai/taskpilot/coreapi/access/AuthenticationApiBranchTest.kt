package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.api.AuthenticationController
import ai.taskpilot.coreapi.access.api.AuthenticationProblemException
import ai.taskpilot.coreapi.access.api.AuthenticationProblemHandler
import ai.taskpilot.coreapi.access.api.CurrentUserResponse
import ai.taskpilot.coreapi.access.api.DesktopBearerAuthenticationFilter
import ai.taskpilot.coreapi.access.api.DesktopPrincipal
import ai.taskpilot.coreapi.access.api.DesktopRequestGuardFilter
import ai.taskpilot.coreapi.access.api.RefreshRequest
import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.IssuedSession
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.SessionFamilyId
import ai.taskpilot.coreapi.access.application.SessionId
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.access.model.UserId
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequestWrapper
import org.junit.jupiter.api.Test
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.http.HttpStatus
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import java.net.URI
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AuthenticationApiBranchTest {
    private val currentUser =
        CurrentUserView(
            UserId(UUID.randomUUID()),
            "Test User",
            URI("https://avatars.githubusercontent.com/u/1"),
        )
    private val session =
        IssuedSession(
            SessionId(UUID.randomUUID()),
            SessionFamilyId(UUID.randomUUID()),
            "access-token",
            Instant.parse("2026-09-30T10:15:00Z"),
            "refresh-token",
            Instant.parse("2026-10-30T10:00:00Z"),
            currentUser,
        )

    @Test
    fun `refresh maps success and authentication failure`() {
        val sessions = StubSessions()
        val controller = AuthenticationController(sessions)
        val request = RefreshRequest("refresh-token")

        sessions.refreshResult = RefreshSessionResult.Refreshed(session)
        assertEquals("access-token", controller.refresh(request).accessToken)

        sessions.refreshResult = RefreshSessionResult.AuthenticationRequired
        assertProblem("AUTHENTICATION_REQUIRED") { controller.refresh(request) }
    }

    @Test
    fun `current user projects the authenticated principal`() {
        val controller = AuthenticationController(StubSessions())
        val principal = DesktopPrincipal("access-token", CurrentUserResponse.from(currentUser))

        assertEquals(CurrentUserResponse.from(currentUser), controller.currentUser(principal))
    }

    @Test
    fun `logout rejects malformed bearer forms and remains idempotent`() {
        val sessions = StubSessions()
        val controller = AuthenticationController(sessions)

        listOf(null, "Basic token", "Bearer ", "Bearer one two", "Bearer ${"x".repeat(513)}").forEach { authorization ->
            val request = MockHttpServletRequest()
            authorization?.let { request.addHeader("Authorization", it) }
            assertProblem("AUTHENTICATION_REQUIRED") { controller.logout(request) }
        }
        val valid = MockHttpServletRequest().apply { addHeader("Authorization", "Bearer access-token") }
        assertEquals(HttpStatus.NO_CONTENT, controller.logout(valid).statusCode)
        assertEquals("access-token", sessions.loggedOut)
    }

    @Test
    fun `problem handler emits safe stable details and optional properties`() {
        val handler = AuthenticationProblemHandler()
        val request = requestWithCorrelation().apply { requestURI = "/desktop/v1/auth/test" }

        val response =
            handler.authenticationProblem(
                AuthenticationProblemException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "credential", 7),
                request,
            )
        assertEquals("Authentication is required.", response.body?.detail)
        assertEquals("AUTHENTICATION_REQUIRED", response.body?.properties?.get("code"))
        assertEquals("credential", response.body?.properties?.get("path"))
        assertEquals(7L, response.body?.properties?.get("retryAfterSeconds"))
        assertEquals(
            "VALIDATION_FAILED",
            handler
                .invalidInput(IllegalArgumentException("secret must not leak"), request)
                .body
                ?.properties
                ?.get("code"),
        )
        val unavailable = handler.temporarilyUnavailable(DataAccessResourceFailureException("database secret"), request)
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, unavailable.statusCode)
        assertEquals("TEMPORARILY_UNAVAILABLE", unavailable.body?.properties?.get("code"))
        assertEquals("The service is temporarily unavailable.", unavailable.body?.detail)
    }

    @Test
    fun `bearer filter authenticates only active tokens`() {
        val sessions = StubSessions()
        val filter = DesktopBearerAuthenticationFilter(sessions)
        val response = MockHttpServletResponse()
        val chain = FilterChain { _, _ -> Unit }

        filter.doFilter(MockHttpServletRequest(), response, chain)
        assertNull(
            org.springframework.security.core.context.SecurityContextHolder
                .getContext()
                .authentication,
        )
        sessions.currentUserResult = CurrentUserResult.AuthenticationRequired
        filter.doFilter(requestWithBearer("invalid"), response, chain)
        assertNull(
            org.springframework.security.core.context.SecurityContextHolder
                .getContext()
                .authentication,
        )
        sessions.currentUserResult = CurrentUserResult.Authenticated(session.currentUser)
        filter.doFilter(requestWithBearer("active"), response, chain)
        assertEquals(
            URI("https://avatars.githubusercontent.com/u/1"),
            assertIs<DesktopPrincipal>(
                assertNotNull(
                    org.springframework.security.core.context.SecurityContextHolder
                        .getContext()
                        .authentication,
                ).principal,
            ).user.avatarUrl,
        )
        org.springframework.security.core.context.SecurityContextHolder
            .clearContext()
    }

    @Test
    fun `request guard normalizes correlation id and rejects oversized body`() {
        val filter = DesktopRequestGuardFilter(maximumBodyBytes = 4)
        val chain = RecordingFilterChain()
        val normal = MockHttpServletRequest().apply { addHeader("X-Correlation-Id", "safe-id_1") }
        val response = MockHttpServletResponse()
        filter.doFilter(normal, response, chain)
        assertTrue(chain.called)
        assertEquals("safe-id_1", response.getHeader("X-Correlation-Id"))

        val unsafe = MockHttpServletRequest().apply { addHeader("X-Correlation-Id", "bad id") }
        filter.doFilter(unsafe, MockHttpServletResponse(), RecordingFilterChain())
        assertTrue(unsafe.getAttribute("taskpilot.correlationId").toString() != "bad id")

        val oversized = MockHttpServletRequest().apply { setContent("12345".toByteArray()) }
        val rejected = MockHttpServletResponse()
        val rejectedChain = RecordingFilterChain()
        filter.doFilter(oversized, rejected, rejectedChain)
        assertEquals(413, rejected.status)
        assertTrue(rejected.contentAsString.contains("REQUEST_TOO_LARGE"))
        assertTrue(!rejectedChain.called)

        val unknownLength =
            object : HttpServletRequestWrapper(MockHttpServletRequest().apply { setContent("12345".toByteArray()) }) {
                override fun getContentLength(): Int = -1

                override fun getContentLengthLong(): Long = -1
            }
        val chunkedRejected = MockHttpServletResponse()
        val chunkedChain = RecordingFilterChain()
        filter.doFilter(unknownLength, chunkedRejected, chunkedChain)
        assertEquals(413, chunkedRejected.status)
        assertTrue(chunkedRejected.contentAsString.contains("REQUEST_TOO_LARGE"))
        assertTrue(!chunkedChain.called)

        val exactLimit = MockHttpServletRequest().apply { setContent("1234".toByteArray()) }
        val exactLimitChain = BodyReadingFilterChain()
        filter.doFilter(exactLimit, MockHttpServletResponse(), exactLimitChain)
        assertEquals("1234", exactLimitChain.body)
    }

    private fun requestWithCorrelation() =
        MockHttpServletRequest().apply {
            remoteAddr = "127.0.0.1"
            setAttribute("taskpilot.correlationId", "correlation")
        }

    private fun requestWithBearer(token: String): MockHttpServletRequest =
        MockHttpServletRequest().also { request -> request.addHeader("Authorization", "Bearer $token") }

    private fun assertProblem(
        expectedCode: String,
        block: () -> Unit,
    ) {
        assertEquals(expectedCode, assertFailsWith<AuthenticationProblemException>(block = block).code)
    }

    private class StubSessions : SessionUseCases {
        var refreshResult: RefreshSessionResult = RefreshSessionResult.AuthenticationRequired
        var currentUserResult: CurrentUserResult = CurrentUserResult.AuthenticationRequired
        var loggedOut: String? = null

        override fun issue(user: ai.taskpilot.coreapi.access.application.SessionUser) = error("not used")

        override fun refresh(refreshToken: String) = refreshResult

        override fun currentUser(accessToken: String) = currentUserResult

        override fun logout(accessToken: String) {
            loggedOut = accessToken
        }
    }

    private class BodyReadingFilterChain : FilterChain {
        var body: String? = null

        override fun doFilter(
            request: jakarta.servlet.ServletRequest,
            response: jakarta.servlet.ServletResponse,
        ) {
            body = request.reader.use { it.readText() }
        }
    }

    private class RecordingFilterChain : FilterChain {
        var called = false

        override fun doFilter(
            request: jakarta.servlet.ServletRequest,
            response: jakarta.servlet.ServletResponse,
        ) {
            called = true
        }
    }
}
