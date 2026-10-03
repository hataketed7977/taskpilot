package ai.taskpilot.coreapi

import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.postgresql.PostgreSQLContainer
import tools.jackson.core.type.TypeReference
import tools.jackson.databind.ObjectMapper
import java.net.HttpURLConnection
import java.net.URI
import java.util.Base64
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private data class OperationContract(
    val requestSchema: String?,
    val responseSchema: String?,
    val statuses: Set<String>,
)

private fun Map<String, Any?>.requiredMap(name: String): Map<String, Any?> {
    @Suppress("UNCHECKED_CAST")
    return assertNotNull(this[name] as? Map<String, Any?>, "missing JSON object $name")
}

private fun Map<String, Any?>.requiredList(name: String): List<Any?> =
    assertNotNull(
        this[name] as? List<Any?>,
        "missing JSON array $name",
    )

private fun Map<String, Any?>.schemaProperties(name: String): Set<String> =
    requiredMap("components")
        .requiredMap("schemas")
        .requiredMap(name)
        .requiredMap("properties")
        .keys

private object OpenApiContractAssertions {
    fun verifyAnonymousOperations(
        paths: Map<String, Any?>,
        operations: Map<String, OperationContract>,
    ) {
        operations.forEach { (path, contract) ->
            val operation = paths.requiredMap(path).requiredMap("post")
            assertEquals("anonymous", operation["x-taskpilot-authentication"], path)
            assertTrue(operation.requiredList("security").isEmpty(), path)
            verifyOperation(operation, contract, path)
        }
    }

    fun verifyRefreshOperation(
        paths: Map<String, Any?>,
        contract: OperationContract,
    ) {
        val refresh = paths.requiredMap("/desktop/v1/auth/session/refresh").requiredMap("post")
        assertEquals("refresh-credential-body", refresh["x-taskpilot-authentication"])
        assertTrue(refresh.requiredList("security").isEmpty())
        verifyOperation(refresh, contract, "refresh")
    }

    fun verifyProtectedOperations(
        paths: Map<String, Any?>,
        operations: Map<Pair<String, String>, OperationContract>,
    ) {
        operations.forEach { (pathAndMethod, contract) ->
            val (path, method) = pathAndMethod
            val operation = paths.requiredMap(path).requiredMap(method)
            assertEquals("access-bearer", operation["x-taskpilot-authentication"], path)
            val security = operation.requiredList("security").single() as Map<*, *>
            assertEquals(setOf("accessBearer"), security.keys, path)
            verifyOperation(operation, contract, path)
        }
    }

    fun verifyNoSecretExamples(
        rawDocument: String,
        examples: Set<String>,
    ) {
        examples.forEach { secret ->
            assertFalse(rawDocument.contains(secret), "OpenAPI leaked secret/example: $secret")
        }
    }

    fun verifyOperation(
        operation: Map<String, Any?>,
        contract: OperationContract,
        label: String,
    ) {
        contract.requestSchema?.let { expected ->
            assertEquals(
                "#/components/schemas/$expected",
                operation
                    .requiredMap("requestBody")
                    .requiredMap("content")
                    .requiredMap("application/json")
                    .requiredMap("schema")["\$ref"],
                "$label request schema",
            )
        }
        val responses = operation.requiredMap("responses")
        assertEquals(contract.statuses, responses.keys, "$label statuses")
        contract.responseSchema?.let { expected ->
            val success = contract.statuses.first { it.startsWith("2") }
            assertEquals(
                "#/components/schemas/$expected",
                responses
                    .requiredMap(success)
                    .requiredMap("content")
                    .requiredMap("application/json")
                    .requiredMap("schema")["\$ref"],
                "$label response schema",
            )
        }
        contract.statuses.filterNot { it.startsWith("2") }.forEach { status ->
            assertEquals(
                "#/components/schemas/TaskPilotProblemDetails",
                responses
                    .requiredMap(status)
                    .requiredMap("content")
                    .requiredMap("application/problem+json")
                    .requiredMap("schema")["\$ref"],
                "$label $status problem schema",
            )
        }
    }

    fun verifyWorkspaceContract(
        document: Map<String, Any?>,
        paths: Map<String, Any?>,
    ) {
        val create = paths.requiredMap("/desktop/v1/workspaces").requiredMap("post")
        val idempotency =
            create
                .requiredList("parameters")
                .map { it as Map<*, *> }
                .single { it["name"] == "Idempotency-Key" }
        assertEquals(true, idempotency["required"])
        assertEquals(setOf("name"), document.schemaProperties("CreateWorkspaceRequest"))
        assertEquals(setOf("workspaceId", "name", "type"), document.schemaProperties("WorkspaceResponse"))
        assertEquals(setOf("items", "capabilities"), document.schemaProperties("WorkspaceListResponse"))
        assertEquals(
            setOf("canCreateWorkspace", "createWorkspaceReasonCode"),
            document.schemaProperties("WorkspaceCapabilitiesResponse"),
        )
    }

    fun verifyProjectContract(
        document: Map<String, Any?>,
        paths: Map<String, Any?>,
    ) {
        val operation =
            paths
                .requiredMap("/desktop/v1/workspaces/{workspaceId}/projects")
                .requiredMap("get")
        val parameters =
            operation
                .requiredList("parameters")
                .map { it as Map<*, *> }
                .associateBy { it["name"] as String }
        assertEquals(setOf("workspaceId", "cursor", "limit"), parameters.keys)
        val limitSchema = parameters.getValue("limit")["schema"] as Map<*, *>
        assertEquals(50, limitSchema["default"])
        assertEquals(1, limitSchema["minimum"])
        assertEquals(100, limitSchema["maximum"])
        assertEquals(setOf("items", "nextCursor"), document.schemaProperties("ProjectPageResponse"))
        assertEquals(setOf("projectId", "workspaceId", "name"), document.schemaProperties("ProjectResponse"))
    }

    fun verifySharedComponents(document: Map<String, Any?>) {
        assertEquals(
            setOf(
                "type",
                "title",
                "status",
                "detail",
                "instance",
                "code",
                "correlationId",
                "path",
                "retryAfterSeconds",
            ),
            document.schemaProperties("TaskPilotProblemDetails"),
        )
        val accessBearer =
            document
                .requiredMap("components")
                .requiredMap("securitySchemes")
                .requiredMap("accessBearer")
        assertEquals("http", accessBearer["type"])
        assertEquals("bearer", accessBearer["scheme"])
        assertTrue(document.schemaProperties("RefreshRequest").contains("refreshRequestId"))
    }
}

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OpenApiIntegrationTest(
    @param:LocalServerPort private val port: Int,
) {
    @Autowired
    private lateinit var objectMapper: ObjectMapper

    @AfterAll
    fun stopPostgreSql() = postgres.stop()

    @Test
    fun `runtime OpenAPI covers authentication contracts`() {
        val (document, rawDocument) = loadDocument()
        val paths = document.requiredMap("paths")
        OpenApiContractAssertions.verifyAnonymousOperations(paths, anonymousOperations)
        OpenApiContractAssertions.verifyRefreshOperation(paths, refreshContract)
        OpenApiContractAssertions.verifyProtectedOperations(paths, protectedOperations)
        OpenApiContractAssertions.verifySharedComponents(document)
        OpenApiContractAssertions.verifyNoSecretExamples(rawDocument, secretExamples)
    }

    @Test
    fun `runtime OpenAPI covers workspace and project contracts`() {
        val (document, _) = loadDocument()
        val paths = document.requiredMap("paths")
        OpenApiContractAssertions.verifyWorkspaceContract(document, paths)
        OpenApiContractAssertions.verifyProjectContract(document, paths)
    }

    @Test
    fun `Swagger UI does not persist authorization`() {
        val swagger = get("/swagger-ui/swagger-initializer.js")
        assertEquals(200, swagger.status)
        assertTrue(Regex("""["]?persistAuthorization["]?\s*:\s*false""").containsMatchIn(swagger.body))
    }

    private fun loadDocument(): Pair<Map<String, Any?>, String> {
        val response = get("/v3/api-docs")
        assertEquals(200, response.status)
        val document = objectMapper.readValue(response.body, object : TypeReference<Map<String, Any?>>() {})
        return document to response.body
    }

    private fun get(path: String): HttpResult {
        val connection = URI("http://127.0.0.1:$port$path").toURL().openConnection() as HttpURLConnection
        val status = connection.responseCode
        val body =
            (if (status >= 400) connection.errorStream else connection.inputStream)
                ?.bufferedReader()
                ?.use { it.readText() }
                .orEmpty()
        return HttpResult(status, body)
    }

    private data class HttpResult(
        val status: Int,
        val body: String,
    )

    companion object {
        private val anonymousOperations =
            mapOf(
                "/desktop/v1/auth/registration/code" to
                    OperationContract(
                        "EmailCodeRequest",
                        "CodeAcceptedResponse",
                        setOf("202", "400", "429", "503"),
                    ),
                "/desktop/v1/auth/registration/code/verify" to
                    OperationContract(
                        "VerifyEmailCodeRequest",
                        "ContinuationResponse",
                        setOf("200", "400", "401", "429", "503"),
                    ),
                "/desktop/v1/auth/registration" to
                    OperationContract(
                        "RegistrationRequest",
                        "SessionResponse",
                        setOf("201", "400", "409", "503"),
                    ),
                "/desktop/v1/auth/login/password" to
                    OperationContract(
                        "PasswordLoginRequest",
                        "SessionResponse",
                        setOf("200", "400", "401", "503"),
                    ),
                "/desktop/v1/auth/login/code" to
                    OperationContract(
                        "EmailCodeRequest",
                        "CodeAcceptedResponse",
                        setOf("202", "400", "429", "503"),
                    ),
                "/desktop/v1/auth/login/code/verify" to
                    OperationContract(
                        "VerifyEmailCodeRequest",
                        "SessionResponse",
                        setOf("200", "400", "401", "429", "503"),
                    ),
                "/desktop/v1/auth/password-reset/code" to
                    OperationContract(
                        "EmailCodeRequest",
                        "CodeAcceptedResponse",
                        setOf("202", "400", "429", "503"),
                    ),
                "/desktop/v1/auth/password-reset/code/verify" to
                    OperationContract(
                        "VerifyEmailCodeRequest",
                        "ContinuationResponse",
                        setOf("200", "400", "401", "429", "503"),
                    ),
                "/desktop/v1/auth/password-reset" to
                    OperationContract(
                        "PasswordResetRequest",
                        null,
                        setOf("204", "400", "409", "503"),
                    ),
            )
        private val refreshContract =
            OperationContract(
                "RefreshRequest",
                "SessionResponse",
                setOf("200", "400", "401", "503"),
            )
        private val protectedOperations =
            mapOf(
                Pair("/desktop/v1/auth/session/logout", "post") to
                    OperationContract(null, null, setOf("204", "401")),
                Pair("/desktop/v1/me", "get") to
                    OperationContract(null, "CurrentUserResponse", setOf("200", "401")),
                Pair("/desktop/v1/workspaces", "get") to
                    OperationContract(null, "WorkspaceListResponse", setOf("200", "401", "503")),
                Pair("/desktop/v1/workspaces", "post") to
                    OperationContract(
                        "CreateWorkspaceRequest",
                        "WorkspaceResponse",
                        setOf("200", "201", "400", "401", "403", "409", "503"),
                    ),
                Pair("/desktop/v1/workspaces/{workspaceId}/projects", "get") to
                    OperationContract(
                        null,
                        "ProjectPageResponse",
                        setOf("200", "400", "401", "404", "503"),
                    ),
            )
        private val secretExamples =
            setOf("valid HTTP password", "123456", "access-token", "refresh-token", "user@example.com")
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
            registry.add("taskpilot.authentication.terms-version") { "2026-09" }
            registry.add("taskpilot.authentication.argon2.memory-kib") { "1024" }
            registry.add("taskpilot.authentication.argon2.iterations") { "1" }
        }
    }
}
