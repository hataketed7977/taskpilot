package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.infrastructure.CapturingVerificationMailSender
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.postgresql.PostgreSQLContainer
import tools.jackson.core.type.TypeReference
import tools.jackson.databind.ObjectMapper
import java.net.HttpURLConnection
import java.net.URI
import java.util.Base64
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@Suppress("TooManyFunctions", "MaxLineLength") // Endpoint scenarios intentionally share one HTTP fixture.
class AuthenticationHttpIntegrationTest(
    @param:LocalServerPort private val port: Int,
) {
    @Autowired
    private lateinit var jdbc: JdbcTemplate

    @Autowired
    private lateinit var mail: CapturingVerificationMailSender

    @Autowired
    private lateinit var objectMapper: ObjectMapper

    @BeforeAll
    fun migrateSchema() {
        Flyway
            .configure()
            .dataSource(requireNotNull(jdbc.dataSource))
            .locations("classpath:db/migration")
            .load()
            .migrate()
    }

    @BeforeEach
    fun clearState() {
        jdbc.execute(
            """
            TRUNCATE project_memberships, projects, workspace_creation_requests, workspace_memberships, workspaces,
                     refresh_recoveries, user_sessions, auth_continuations, verification_challenges,
                     verification_rate_limits, terms_acceptances, password_credentials,
                     email_identities, app_users
            """.trimIndent(),
        )
        mail.clear()
    }

    @AfterAll
    fun stopPostgreSql() = postgres.stop()

    @Test
    fun `registration creates session and bearer current user without exposing internal session data`() {
        val session = register("http-registration@example.com")

        assertEquals(setOf("accessToken", "accessTokenExpiresAt", "refreshToken", "refreshTokenExpiresAt", "currentUser"), session.keys)
        assertFalse(session.containsKey("sessionId"))
        assertFalse(session.containsKey("familyId"))
        val access = session.requiredText("accessToken")
        val me = request("GET", "/desktop/v1/me", bearer = access)
        assertEquals(200, me.status)
        assertEquals("http-registration@example.com", me.json().requiredText("email"))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM user_sessions WHERE access_token_digest = ?", Int::class.java, access))
    }

    @Test
    fun `password and email code login return the same session shape and invalid credentials do not enumerate`() {
        register("login-http@example.com")
        val wrongKnown =
            post(
                "/desktop/v1/auth/login/password",
                mapOf(
                    "email" to "login-http@example.com",
                    "password" to "wrong password value",
                ),
            )
        val wrongUnknown =
            post(
                "/desktop/v1/auth/login/password",
                mapOf(
                    "email" to "missing-http@example.com",
                    "password" to "wrong password value",
                ),
            )
        assertEquals(401, wrongKnown.status)
        assertEquals(wrongKnown.json().requiredText("code"), wrongUnknown.json().requiredText("code"))
        assertEquals("INVALID_CREDENTIALS", wrongKnown.json().requiredText("code"))

        val password = post("/desktop/v1/auth/login/password", mapOf("email" to "login-http@example.com", "password" to PASSWORD))
        assertEquals(200, password.status)

        val codeAccepted = requestCode("/desktop/v1/auth/login/code", "login-http@example.com")
        val code = requireNotNull(mail.commands.lastOrNull()).code.toStringValue()
        val codeLogin =
            post(
                "/desktop/v1/auth/login/code/verify",
                mapOf(
                    "challengeId" to codeAccepted.requiredText("challengeId"),
                    "email" to "login-http@example.com",
                    "code" to code,
                    "deviceInstallationId" to DEVICE,
                ),
            )
        assertEquals(200, codeLogin.status)
        assertEquals(password.json().keys, codeLogin.json().keys)
    }

    @Test
    fun `password reset revokes sessions and requires login with the new password`() {
        val original = register("reset-http@example.com")
        val accepted = requestCode("/desktop/v1/auth/password-reset/code", "reset-http@example.com")
        val code = requireNotNull(mail.commands.lastOrNull()).code.toStringValue()
        val verified =
            post(
                "/desktop/v1/auth/password-reset/code/verify",
                mapOf(
                    "challengeId" to accepted.requiredText("challengeId"),
                    "email" to "reset-http@example.com",
                    "code" to code,
                    "deviceInstallationId" to DEVICE,
                ),
            ).json()
        val reset =
            post(
                "/desktop/v1/auth/password-reset",
                mapOf(
                    "continuationId" to verified.requiredText("continuationId"),
                    "continuationSecret" to verified.requiredText("continuationSecret"),
                    "email" to "reset-http@example.com",
                    "newPassword" to NEW_PASSWORD,
                ),
            )
        assertEquals(204, reset.status)
        assertEquals(401, request("GET", "/desktop/v1/me", bearer = original.requiredText("accessToken")).status)
        assertEquals(
            401,
            post("/desktop/v1/auth/login/password", mapOf("email" to "reset-http@example.com", "password" to PASSWORD)).status,
        )
        assertEquals(
            200,
            post("/desktop/v1/auth/login/password", mapOf("email" to "reset-http@example.com", "password" to NEW_PASSWORD)).status,
        )
    }

    @Test
    fun `refresh recovers by request id and logout is idempotent`() {
        val original = register("refresh-http@example.com")
        val refreshRequestId = UUID.randomUUID().toString()
        val body = mapOf("refreshToken" to original.requiredText("refreshToken"), "refreshRequestId" to refreshRequestId)
        val first = post("/desktop/v1/auth/session/refresh", body)
        val recovered = post("/desktop/v1/auth/session/refresh", body)
        assertEquals(200, first.status)
        assertEquals(first.body, recovered.body)
        val access = first.json().requiredText("accessToken")
        assertEquals(204, request("POST", "/desktop/v1/auth/session/logout", bearer = access).status)
        assertEquals(204, request("POST", "/desktop/v1/auth/session/logout", bearer = access).status)
        assertEquals(401, request("POST", "/desktop/v1/auth/session/logout").status)
        assertEquals(401, request("GET", "/desktop/v1/me", bearer = access).status)
    }

    @Test
    fun `workspace list and create enforce bearer strict body idempotency and stable representations`() {
        val session = register("workspace-http@example.com")
        val access = session.requiredText("accessToken")

        assertEquals(401, request("GET", "/desktop/v1/workspaces").status)
        val empty = request("GET", "/desktop/v1/workspaces", bearer = access)
        assertEquals(200, empty.status)
        assertEquals(emptyList<Any?>(), empty.json()["items"])
        val capabilities = empty.json()["capabilities"] as Map<*, *>
        assertEquals(setOf("canCreateWorkspace"), capabilities.keys)
        assertEquals(true, capabilities["canCreateWorkspace"])

        val created = postWorkspace(access, "create-1", mapOf("name" to "  Platform  "))
        assertEquals(201, created.status)
        assertEquals(setOf("workspaceId", "name", "type"), created.json().keys)
        assertEquals("Platform", created.json().requiredText("name"))
        assertEquals("ORGANIZATION", created.json().requiredText("type"))

        val replay = postWorkspace(access, "create-1", mapOf("name" to "Platform"))
        assertEquals(200, replay.status)
        assertEquals(created.body, replay.body)
        val conflict = postWorkspace(access, "create-1", mapOf("name" to "Different"))
        assertEquals(409, conflict.status)
        assertEquals("IDEMPOTENCY_KEY_REUSED", conflict.json().requiredText("code"))

        assertEquals(400, postWorkspace(access, "create-2", mapOf("name" to "Bad", "type" to "PERSONAL")).status)
        val invalidName = postWorkspace(access, "create-3", mapOf("name" to "bad\nname"))
        assertEquals(400, invalidName.status)
        assertEquals("name", invalidName.json().requiredText("path"))

        val listed = request("GET", "/desktop/v1/workspaces", bearer = access).json()
        val items = listed["items"] as List<*>
        assertEquals(1, items.size)
        assertEquals(created.json(), items.single())
    }

    @Test
    fun `project list is workspace scoped bearer protected paginated and non enumerating`() {
        val session = register("projects-http@example.com")
        val access = session.requiredText("accessToken")
        val created = postWorkspace(access, "project-workspace", mapOf("name" to "Projects")).json()
        val workspaceId = created.requiredText("workspaceId")
        val userId = (session["currentUser"] as Map<*, *>)["userId"].toString()
        val firstProject = UUID.randomUUID()
        val secondProject = UUID.randomUUID()
        listOf(firstProject to "First", secondProject to "Second").sortedBy { it.first }.forEach { (projectId, name) ->
            jdbc.update(
                "INSERT INTO projects(project_id, workspace_id, name, created_at) VALUES (?, ?, ?, now())",
                projectId,
                UUID.fromString(workspaceId),
                name,
            )
            jdbc.update(
                "INSERT INTO project_memberships(project_id, workspace_id, user_id, joined_at) VALUES (?, ?, ?, now())",
                projectId,
                UUID.fromString(workspaceId),
                UUID.fromString(userId),
            )
        }

        assertEquals(401, request("GET", "/desktop/v1/workspaces/$workspaceId/projects").status)
        val first = request("GET", "/desktop/v1/workspaces/$workspaceId/projects?limit=1", bearer = access).json()
        assertEquals(1, (first["items"] as List<*>).size)
        val cursor = first.requiredText("nextCursor")
        val second = request("GET", "/desktop/v1/workspaces/$workspaceId/projects?limit=1&cursor=$cursor", bearer = access).json()
        assertEquals(1, (second["items"] as List<*>).size)
        assertFalse(second.containsKey("nextCursor"))
        assertEquals(400, request("GET", "/desktop/v1/workspaces/$workspaceId/projects?limit=0", bearer = access).status)
        assertEquals(400, request("GET", "/desktop/v1/workspaces/$workspaceId/projects?cursor=invalid", bearer = access).status)
        assertEquals(400, request("GET", "/desktop/v1/workspaces/$workspaceId/projects?unexpected=true", bearer = access).status)
        assertEquals(404, request("GET", "/desktop/v1/workspaces/${UUID.randomUUID()}/projects", bearer = access).status)
    }

    @Test
    fun `unknown fields oversized bodies and protected requests fail closed`() {
        assertEquals(401, request("GET", "/desktop/v1/me").status)
        val unknown = post("/desktop/v1/auth/login/password", mapOf("email" to "a@example.com", "password" to PASSWORD, "extra" to true))
        assertEquals(400, unknown.status)
        assertEquals("VALIDATION_FAILED", unknown.json().requiredText("code"))
        val oversizedBody = "{\"padding\":\"${"x".repeat(17_000)}\"}"
        val oversized = request("POST", "/desktop/v1/auth/login/password", oversizedBody)
        assertEquals(413, oversized.status)
        assertFalse(oversized.body.contains(PASSWORD))

        val chunkedOversized = request("POST", "/desktop/v1/auth/login/password", oversizedBody, chunked = true)
        assertEquals(413, chunkedOversized.status)
        assertEquals("REQUEST_TOO_LARGE", chunkedOversized.json().requiredText("code"))
    }

    private fun register(email: String): Map<String, Any?> {
        val accepted = requestCode("/desktop/v1/auth/registration/code", email)
        val code = requireNotNull(mail.commands.lastOrNull()).code.toStringValue()
        val verified =
            post(
                "/desktop/v1/auth/registration/code/verify",
                mapOf(
                    "challengeId" to accepted.requiredText("challengeId"),
                    "email" to email,
                    "code" to code,
                    "deviceInstallationId" to DEVICE,
                ),
            ).json()
        val registered =
            post(
                "/desktop/v1/auth/registration",
                mapOf(
                    "continuationId" to verified.requiredText("continuationId"),
                    "continuationSecret" to verified.requiredText("continuationSecret"),
                    "email" to email,
                    "displayName" to "HTTP Test User",
                    "password" to PASSWORD,
                    "termsVersion" to TERMS,
                ),
            )
        assertEquals(201, registered.status)
        return registered.json()
    }

    private fun requestCode(
        path: String,
        email: String,
    ): Map<String, Any?> {
        val response = post(path, mapOf("email" to email, "deviceInstallationId" to DEVICE))
        assertEquals(202, response.status)
        assertTrue(response.json().requiredText("challengeId").isNotBlank())
        return response.json()
    }

    private fun post(
        path: String,
        body: Map<String, Any?>,
    ): HttpResult = request("POST", path, objectMapper.writeValueAsString(body))

    private fun postWorkspace(
        bearer: String,
        idempotencyKey: String,
        body: Map<String, Any?>,
    ): HttpResult = request("POST", "/desktop/v1/workspaces", objectMapper.writeValueAsString(body), bearer, idempotencyKey)

    @Suppress("LongParameterList") // The HTTP fixture keeps optional transport controls visible at each call site.
    private fun request(
        method: String,
        path: String,
        body: String? = null,
        bearer: String? = null,
        idempotencyKey: String? = null,
        chunked: Boolean = false,
    ): HttpResult {
        val connection = URI("http://127.0.0.1:$port$path").toURL().openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("Content-Type", "application/json")
        bearer?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
        idempotencyKey?.let { connection.setRequestProperty("Idempotency-Key", it) }
        if (chunked) connection.setChunkedStreamingMode(1_024)
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toByteArray()) }
        }
        val status = connection.responseCode
        val responseBody =
            (if (status >= 400) connection.errorStream else connection.inputStream)
                ?.bufferedReader()
                ?.use { it.readText() }
                .orEmpty()
        return HttpResult(status, responseBody)
    }

    private fun HttpResult.json(): Map<String, Any?> = objectMapper.readValue(body, object : TypeReference<Map<String, Any?>>() {})

    private fun Map<String, Any?>.requiredText(name: String): String = requireNotNull(this[name]).toString()

    private fun ai.taskpilot.coreapi.access.model.VerificationCode.toStringValue(): String {
        val field = javaClass.getDeclaredField("value")
        field.trySetAccessible()
        return field.get(this).toString()
    }

    private data class HttpResult(
        val status: Int,
        val body: String,
    )

    companion object {
        private const val PASSWORD = "valid HTTP password"
        private const val NEW_PASSWORD = "new valid HTTP password"
        private const val TERMS = "2026-09"
        private const val DEVICE = "desktop-http-integration"
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }
        private val pepper = Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
        private val recoveryKey = Base64.getEncoder().encodeToString(ByteArray(32) { 11 })

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
            registry.add("taskpilot.verification.enabled") { "true" }
            registry.add("taskpilot.verification.mail-adapter") { "capture" }
            registry.add("taskpilot.verification.pepper-base64") { pepper }
            registry.add("taskpilot.authentication.enabled") { "true" }
            registry.add("taskpilot.authentication.token-pepper-base64") { pepper }
            registry.add("taskpilot.authentication.recovery-key-base64") { recoveryKey }
            registry.add("taskpilot.authentication.terms-version") { TERMS }
            registry.add("taskpilot.authentication.argon2.memory-kib") { "1024" }
            registry.add("taskpilot.authentication.argon2.iterations") { "1" }
        }
    }
}
