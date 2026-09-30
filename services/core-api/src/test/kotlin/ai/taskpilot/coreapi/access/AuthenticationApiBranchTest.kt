package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.api.AuthenticationController
import ai.taskpilot.coreapi.access.api.AuthenticationProblemException
import ai.taskpilot.coreapi.access.api.AuthenticationProblemHandler
import ai.taskpilot.coreapi.access.api.CodeAcceptedResponse
import ai.taskpilot.coreapi.access.api.DesktopBearerAuthenticationFilter
import ai.taskpilot.coreapi.access.api.DesktopPrincipal
import ai.taskpilot.coreapi.access.api.DesktopRequestGuardFilter
import ai.taskpilot.coreapi.access.api.EmailCodeRequest
import ai.taskpilot.coreapi.access.api.PasswordLoginRequest
import ai.taskpilot.coreapi.access.api.PasswordResetRequest
import ai.taskpilot.coreapi.access.api.RefreshRequest
import ai.taskpilot.coreapi.access.api.RegistrationRequest
import ai.taskpilot.coreapi.access.api.VerifyEmailCodeRequest
import ai.taskpilot.coreapi.access.application.AcceptedCodeRequest
import ai.taskpilot.coreapi.access.application.AuthenticationFlowService
import ai.taskpilot.coreapi.access.application.AuthenticationResult
import ai.taskpilot.coreapi.access.application.CodeRequestOutcome
import ai.taskpilot.coreapi.access.application.CodeVerificationOutcome
import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.IssuedFlowContinuation
import ai.taskpilot.coreapi.access.application.IssuedSession
import ai.taskpilot.coreapi.access.application.PasswordResetResult
import ai.taskpilot.coreapi.access.application.RefreshSessionCommand
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.RegistrationResult
import ai.taskpilot.coreapi.access.application.SessionFamilyId
import ai.taskpilot.coreapi.access.application.SessionId
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.access.application.VerificationRequestContext
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.VerificationPurpose
import jakarta.servlet.FilterChain
import org.junit.jupiter.api.Test
import org.springframework.http.HttpStatus
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@Suppress("TooManyFunctions")
class AuthenticationApiBranchTest {
    private val session =
        IssuedSession(
            SessionId(UUID.randomUUID()),
            SessionFamilyId(UUID.randomUUID()),
            "access-token",
            Instant.parse("2026-09-30T10:15:00Z"),
            "refresh-token",
            Instant.parse("2026-10-30T10:00:00Z"),
            CurrentUserView(UserId(UUID.randomUUID()), "Test User", "user@example.com"),
        )

    @Test
    fun `registration maps every stable result`() {
        val flow = StubFlow()
        val controller = AuthenticationController(flow, StubSessions())
        val request =
            RegistrationRequest(
                UUID.randomUUID(),
                "continuation-secret",
                "user@example.com",
                "Test User",
                "valid password",
                "2026-09",
            )

        flow.registration = RegistrationResult.Registered(session)
        assertEquals(HttpStatus.CREATED, controller.register(request).statusCode)
        listOf(
            RegistrationResult.ContextExpired to "REGISTRATION_CONTEXT_EXPIRED",
            RegistrationResult.EmailAlreadyRegistered to "EMAIL_ALREADY_REGISTERED",
            RegistrationResult.TermsVersionRejected to "TERMS_VERSION_REJECTED",
        ).forEach { (result, code) ->
            flow.registration = result
            assertEquals(code, assertFailsWith<AuthenticationProblemException> { controller.register(request) }.code)
        }
    }

    @Test
    fun `password login reset and refresh map success and failure`() {
        val flow = StubFlow()
        val sessions = StubSessions()
        val controller = AuthenticationController(flow, sessions)

        flow.authentication = AuthenticationResult.Authenticated(session)
        assertEquals(
            "access-token",
            controller.loginWithPassword(PasswordLoginRequest("user@example.com", "password")).accessToken,
        )
        flow.authentication = AuthenticationResult.InvalidCredentials
        assertProblem("INVALID_CREDENTIALS") {
            controller.loginWithPassword(PasswordLoginRequest("user@example.com", "bad-password"))
        }
        flow.authentication = AuthenticationResult.InvalidOrExpiredCode
        assertProblem("INVALID_CREDENTIALS") {
            controller.loginWithPassword(PasswordLoginRequest("user@example.com", "bad-password"))
        }

        val reset = PasswordResetRequest(UUID.randomUUID(), "secret", "user@example.com", "new password")
        flow.passwordReset = PasswordResetResult.PASSWORD_UPDATED
        assertEquals(HttpStatus.NO_CONTENT, controller.resetPassword(reset).statusCode)
        flow.passwordReset = PasswordResetResult.CONTEXT_EXPIRED
        assertProblem("PASSWORD_RESET_CONTEXT_EXPIRED") { controller.resetPassword(reset) }

        val refresh = RefreshRequest("refresh-token", UUID.randomUUID())
        sessions.refreshResult = RefreshSessionResult.Refreshed(session)
        assertEquals("access-token", controller.refresh(refresh).accessToken)
        sessions.refreshResult = RefreshSessionResult.AuthenticationRequired
        assertProblem("AUTHENTICATION_REQUIRED") { controller.refresh(refresh) }
    }

    @Test
    fun `code request maps accepted limited and unavailable outcomes`() {
        val flow = StubFlow()
        val controller = AuthenticationController(flow, StubSessions())
        val body = EmailCodeRequest("user@example.com", "device")
        val request = requestWithCorrelation()

        flow.codeRequest = CodeRequestOutcome.Accepted(AcceptedCodeRequest(UUID.randomUUID(), 30))
        val accepted = controller.requestRegistrationCode(body, request)
        assertEquals(HttpStatus.ACCEPTED, accepted.statusCode)
        assertIs<CodeAcceptedResponse>(accepted.body)

        flow.codeRequest = CodeRequestOutcome.RateLimited(12)
        assertProblem("AUTHENTICATION_RATE_LIMITED") { controller.requestLoginCode(body, request) }
        flow.codeRequest = CodeRequestOutcome.TemporarilyUnavailable
        assertProblem("AUTHENTICATION_TEMPORARILY_UNAVAILABLE") {
            controller.requestPasswordResetCode(body, request)
        }
    }

    @Test
    fun `login code maps all verification outcomes`() {
        val flow = StubFlow()
        val controller = AuthenticationController(flow, StubSessions())
        val body = verifyRequest()
        val request = requestWithCorrelation()

        flow.verification = CodeVerificationOutcome.Session(session)
        assertEquals("access-token", controller.verifyLoginCode(body, request).accessToken)
        flow.verification = CodeVerificationOutcome.RateLimited(9)
        assertProblem("AUTHENTICATION_RATE_LIMITED") { controller.verifyLoginCode(body, request) }
        flow.verification = CodeVerificationOutcome.InvalidOrExpired
        assertProblem("INVALID_OR_EXPIRED_CODE") { controller.verifyLoginCode(body, request) }
        flow.verification = CodeVerificationOutcome.TooManyAttempts
        assertProblem("INVALID_OR_EXPIRED_CODE") { controller.verifyLoginCode(body, request) }
        flow.verification = continuation()
        assertFailsWith<IllegalStateException> { controller.verifyLoginCode(body, request) }
    }

    @Test
    fun `continuation verification maps all outcomes`() {
        val flow = StubFlow()
        val controller = AuthenticationController(flow, StubSessions())
        val body = verifyRequest()
        val request = requestWithCorrelation()

        flow.verification = continuation()
        assertNotNull(controller.verifyRegistrationCode(body, request).continuationSecret)
        flow.verification = CodeVerificationOutcome.RateLimited(8)
        assertProblem("AUTHENTICATION_RATE_LIMITED") { controller.verifyPasswordResetCode(body, request) }
        flow.verification = CodeVerificationOutcome.InvalidOrExpired
        assertProblem("INVALID_OR_EXPIRED_CODE") { controller.verifyRegistrationCode(body, request) }
        flow.verification = CodeVerificationOutcome.TooManyAttempts
        assertProblem("INVALID_OR_EXPIRED_CODE") { controller.verifyRegistrationCode(body, request) }
        flow.verification = CodeVerificationOutcome.Session(session)
        assertFailsWith<IllegalStateException> { controller.verifyPasswordResetCode(body, request) }
    }

    @Test
    fun `logout rejects malformed bearer forms and remains idempotent`() {
        val sessions = StubSessions()
        val controller = AuthenticationController(StubFlow(), sessions)

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
        val expected =
            mapOf(
                "INVALID_CREDENTIALS" to "The credentials could not be verified.",
                "INVALID_OR_EXPIRED_CODE" to "The verification code is invalid or expired.",
                "REGISTRATION_CONTEXT_EXPIRED" to "Verify the email address again.",
                "PASSWORD_RESET_CONTEXT_EXPIRED" to "Verify the email address again.",
                "AUTHENTICATION_REQUIRED" to "Authentication is required.",
                "AUTHENTICATION_RATE_LIMITED" to "Try again later.",
                "AUTHENTICATION_TEMPORARILY_UNAVAILABLE" to "Authentication is temporarily unavailable.",
                "VALIDATION_FAILED" to "The request is invalid.",
            )
        expected.forEach { (code, detail) ->
            val response =
                handler.authenticationProblem(
                    AuthenticationProblemException(HttpStatus.BAD_REQUEST, code, "email", 7),
                    request,
                )
            assertEquals(detail, response.body?.detail)
            assertEquals(code, response.body?.properties?.get("code"))
            assertEquals("email", response.body?.properties?.get("path"))
            assertEquals(7L, response.body?.properties?.get("retryAfterSeconds"))
        }
        assertEquals(
            "VALIDATION_FAILED",
            handler
                .invalidInput(IllegalArgumentException("secret must not leak"), request)
                .body
                ?.properties
                ?.get("code"),
        )
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
            "user@example.com",
            assertIs<DesktopPrincipal>(
                assertNotNull(
                    org.springframework.security.core.context.SecurityContextHolder
                        .getContext()
                        .authentication,
                ).principal,
            ).user.email,
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
    }

    private fun continuation() =
        CodeVerificationOutcome.Continuation(
            IssuedFlowContinuation(UUID.randomUUID(), "continuation-secret", Instant.parse("2026-09-30T10:05:00Z")),
        )

    private fun verifyRequest() = VerifyEmailCodeRequest(UUID.randomUUID(), "user@example.com", "123456", "device")

    private fun requestWithCorrelation() =
        MockHttpServletRequest().apply {
            remoteAddr = "127.0.0.1"
            setAttribute("taskpilot.correlationId", "correlation")
        }

    private fun requestWithBearer(token: String): MockHttpServletRequest =
        MockHttpServletRequest().also { request ->
            request.addHeader("Authorization", "Bearer $token")
        }

    private fun assertProblem(
        expectedCode: String,
        block: () -> Unit,
    ) {
        assertEquals(expectedCode, assertFailsWith<AuthenticationProblemException>(block = block).code)
    }

    private class StubFlow : AuthenticationFlowService {
        var codeRequest: CodeRequestOutcome = CodeRequestOutcome.TemporarilyUnavailable
        var verification: CodeVerificationOutcome = CodeVerificationOutcome.InvalidOrExpired
        var registration: RegistrationResult = RegistrationResult.ContextExpired
        var authentication: AuthenticationResult = AuthenticationResult.InvalidCredentials
        var passwordReset: PasswordResetResult = PasswordResetResult.CONTEXT_EXPIRED

        override fun requestCode(
            rawEmail: String,
            purpose: VerificationPurpose,
            context: VerificationRequestContext,
        ) = codeRequest

        override fun verifyCode(
            challengeId: UUID,
            rawEmail: String,
            rawCode: String,
            purpose: VerificationPurpose,
            context: VerificationRequestContext,
        ) = verification

        override fun register(
            continuationId: UUID,
            continuationSecret: String,
            rawEmail: String,
            displayName: String,
            password: CharSequence,
            termsVersion: String,
        ) = registration

        override fun loginWithPassword(
            rawEmail: String,
            password: CharSequence,
        ) = authentication

        override fun resetPassword(
            continuationId: UUID,
            continuationSecret: String,
            rawEmail: String,
            newPassword: CharSequence,
        ) = passwordReset
    }

    private class StubSessions : SessionUseCases {
        var refreshResult: RefreshSessionResult = RefreshSessionResult.AuthenticationRequired
        var currentUserResult: CurrentUserResult = CurrentUserResult.AuthenticationRequired
        var loggedOut: String? = null

        override fun refresh(command: RefreshSessionCommand) = refreshResult

        override fun currentUser(accessToken: String) = currentUserResult

        override fun logout(accessToken: String) {
            loggedOut = accessToken
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
