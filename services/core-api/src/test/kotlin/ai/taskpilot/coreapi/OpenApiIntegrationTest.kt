package ai.taskpilot.coreapi

import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.connection.RedisStandaloneConfiguration
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.GenericContainer
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
    val authentication: String,
)

private fun Map<String, Any?>.requiredMap(name: String): Map<String, Any?> {
    @Suppress("UNCHECKED_CAST")
    return assertNotNull(this[name] as? Map<String, Any?>, "missing JSON object $name")
}

private fun Map<String, Any?>.requiredList(name: String): List<Any?> = assertNotNull(this[name] as? List<Any?>, "missing JSON array $name")

private fun Map<String, Any?>.schema(name: String): Map<String, Any?> = requiredMap("components").requiredMap("schemas").requiredMap(name)

private fun Map<String, Any?>.schemaProperties(name: String): Set<String> = schema(name).requiredMap("properties").keys

private fun Map<String, Any?>.schemaRequiredProperties(name: String): Set<String> =
    (schema(name)["required"] as? List<*>)?.filterIsInstance<String>()?.toSet().orEmpty()

private fun Map<String, Any?>.schemaProperty(
    schemaName: String,
    propertyName: String,
): Map<String, Any?> = schema(schemaName).requiredMap("properties").requiredMap(propertyName)

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OpenApiIntegrationTest(
    @param:LocalServerPort private val port: Int,
) {
    @Autowired
    private lateinit var objectMapper: ObjectMapper

    @AfterAll
    fun stopContainers() {
        redisConnection.destroy()
        redis.stop()
        postgres.stop()
    }

    @Test
    fun `runtime OpenAPI covers the current Desktop contract`() {
        val response = get("/v3/api-docs")
        assertEquals(200, response.status)
        val document = objectMapper.readValue(response.body, object : TypeReference<Map<String, Any?>>() {})
        val paths = document.requiredMap("paths")

        assertEquals(
            operations.keys.map { it.first }.toSet(),
            paths.keys.filter { it.startsWith("/desktop/v1/") }.toSet(),
        )
        operations.forEach { (pathAndMethod, contract) ->
            val (path, method) = pathAndMethod
            val operation = paths.requiredMap(path).requiredMap(method)
            assertEquals(contract.authentication, operation["x-taskpilot-authentication"], path)
            val security = operation.requiredList("security")
            if (contract.authentication == "access-bearer") {
                assertEquals(setOf("accessBearer"), (security.single() as Map<*, *>).keys, path)
            } else {
                assertTrue(security.isEmpty(), path)
            }
            assertEquals(contract.statuses, operation.requiredMap("responses").keys, path)
            assertEquals(contract.requestSchema, operation.requestSchema(), path)
            assertEquals(contract.responseSchema, operation.successSchema(), path)
            contract.statuses.filterNot { it.startsWith('2') }.forEach { status ->
                assertEquals("TaskPilotProblemDetails", operation.problemSchema(status), "$method $path $status")
            }
        }

        verifySchemas(document)
        verifyDescriptions(paths)
        verifySharedComponents(document)
        verifyNoLegacyPaths(paths)
        verifyNoSecretExamples(document, response.body)
    }

    @Test
    fun `Swagger UI does not persist authorization`() {
        val swagger = get("/swagger-ui/swagger-initializer.js")
        assertEquals(200, swagger.status)
        assertTrue(Regex("""["]?persistAuthorization["]?\s*:\s*false""").containsMatchIn(swagger.body))
    }

    private fun verifySchemas(document: Map<String, Any?>) {
        assertEquals(
            listOf("github"),
            document.schema("FederatedAttemptRequest").requiredMap("properties").requiredMap("provider")["enum"],
        )
        val installationId =
            document
                .schema(
                    "FederatedAttemptRequest",
                ).requiredMap("properties")
                .requiredMap("installationId")
        assertEquals(200, installationId["maxLength"])
        assertEquals("^[A-Za-z0-9_.:-]+$", installationId["pattern"])
        val completionUri =
            document
                .schema(
                    "FederatedAttemptRequest",
                ).requiredMap("properties")
                .requiredMap("completionUri")
        assertEquals(2048, completionUri["maxLength"])
        assertEquals(COMPLETION_URI_PATTERN, completionUri["pattern"])

        assertEquals(setOf("pollSecret", "completionProof"), document.schemaProperties("FederatedPollRequest"))
        assertEquals(
            setOf(
                "continuationId",
                "continuationSecret",
                "displayName",
                "useSuggestedAvatar",
                "legalBundleVersion",
                "termsVersion",
                "privacyVersion",
                "locale",
            ),
            document.schemaProperties("FederatedRegistrationRequest"),
        )
        assertEquals(setOf("pollSecret"), document.schemaProperties("FederatedAttemptSecretRequest"))
        assertEquals(
            setOf(
                "continuationId",
                "continuationSecret",
                "suggestedDisplayName",
                "suggestedAvatarUrl",
                "legalBundleVersion",
                "termsVersion",
                "privacyVersion",
                "legalLocales",
                "expiresAt",
            ),
            document.schemaProperties("RegistrationPreviewResponse"),
        )
        assertEquals(setOf("status", "registration", "session", "bootstrap"), document.schemaProperties("FederatedPollResponse"))
        assertEquals(
            setOf("accessToken", "accessTokenExpiresAt", "refreshToken", "refreshTokenExpiresAt", "currentUser"),
            document.schemaProperties("SessionResponse"),
        )
        assertEquals(setOf("workspaceId", "projectId"), document.schemaProperties("FederatedBootstrapResponse"))
        assertEquals(setOf("refreshToken"), document.schemaProperties("RefreshRequest"))
        assertEquals(setOf("userId", "displayName", "avatarUrl"), document.schemaProperties("CurrentUserResponse"))
        assertFalse(document.schemaProperties("CurrentUserResponse").contains("email"))
        assertEquals(
            setOf("workspaceId", "type", "role", "createdAt", "updatedAt"),
            document.schemaProperties("PersonalWorkspaceResponse"),
        )
        assertEquals(setOf("items", "nextCursor"), document.schemaProperties("ProjectPage"))
        assertEquals(
            setOf(
                "projectId",
                "workspaceId",
                "name",
                "description",
                "status",
                "version",
                "createdAt",
                "updatedAt",
                "archivedAt",
            ),
            document.schemaProperties("ProjectView"),
        )
        assertEquals(setOf("requestId", "name", "description", "locale"), document.schemaProperties("CreateProjectRequest"))
        assertEquals(
            setOf("boardId", "projectId", "name", "description", "version", "createdAt", "updatedAt"),
            document.schemaProperties("BoardSummary"),
        )
        assertEquals(
            setOf("boardId", "projectId", "name", "description", "version", "createdAt", "updatedAt", "columns"),
            document.schemaProperties("BoardView"),
        )
        assertEquals(
            setOf("columnId", "name", "position", "version", "createdAt", "updatedAt", "cards"),
            document.schemaProperties("BoardColumnView"),
        )
        assertEquals(
            setOf("workItemId", "title", "description", "lifecycle", "workItemVersion", "placementVersion", "position"),
            document.schemaProperties("CardView"),
        )
        assertEquals(
            setOf("workItemId", "projectId", "title", "description", "lifecycle", "version", "createdAt", "updatedAt"),
            document.schemaProperties("WorkItemView"),
        )
        assertEquals(setOf("workItem", "board"), document.schemaProperties("CreateWorkItemResult"))
        assertEquals(setOf("workItem", "board"), document.schemaProperties("EditWorkItemResult"))
        assertEquals(setOf("requestId", "name", "description", "locale"), document.schemaProperties("CreateBoardRequest"))
        assertEquals(setOf("expectedVersion", "name", "description"), document.schemaProperties("EditBoardRequest"))
        assertEquals(setOf("requestId", "expectedBoardVersion", "name"), document.schemaProperties("CreateColumnRequest"))
        assertEquals(setOf("expectedBoardVersion", "expectedColumnVersion", "name"), document.schemaProperties("EditColumnRequest"))
        assertEquals(setOf("expectedBoardVersion", "columnIds"), document.schemaProperties("ReorderColumnsRequest"))
        assertEquals(
            setOf("requestId", "expectedBoardVersion", "columnId", "title", "description"),
            document.schemaProperties("CreateWorkItemRequest"),
        )
        assertEquals(
            setOf(
                "boardId",
                "currentColumnId",
                "targetColumnId",
                "expectedBoardVersion",
                "expectedPlacementVersion",
                "expectedVersion",
                "title",
                "description",
            ),
            document.schemaProperties("EditWorkItemRequest"),
        )
        assertFalse("expectedBoardVersion" in document.schemaRequiredProperties("EditWorkItemRequest"))
        assertFalse("expectedPlacementVersion" in document.schemaRequiredProperties("EditWorkItemRequest"))
        assertEquals(
            setOf("expectedBoardVersion", "expectedPlacementVersion", "targetColumnId", "beforeWorkItemId"),
            document.schemaProperties("MovePlacementRequest"),
        )
        assertEquals(setOf("expectedVersion", "name", "description"), document.schemaProperties("EditProjectRequest"))
        assertEquals(setOf("expectedVersion"), document.schemaProperties("ProjectStatusRequest"))
        assertEquals(
            setOf("expectedVersion", "confirmationName"),
            document.schemaProperties("DeleteProjectRequest"),
        )
        assertEquals(listOf("ACTIVE", "ARCHIVED"), document.schemaProperty("ProjectView", "status")["enum"])
        assertEquals(listOf("PERSONAL"), document.schemaProperty("PersonalWorkspaceResponse", "type")["enum"])
        assertEquals(listOf("OWNER"), document.schemaProperty("PersonalWorkspaceResponse", "role")["enum"])
    }

    private fun verifyDescriptions(paths: Map<String, Any?>) {
        val poll =
            paths
                .requiredMap(
                    "/desktop/v1/auth/federated/attempts/{attemptId}/poll",
                ).requiredMap("post")["description"] as String
        assertTrue(poll.contains("known External Identity", ignoreCase = true))
        assertTrue(poll.contains("active opaque session"))
        val registration =
            paths
                .requiredMap(
                    "/desktop/v1/auth/federated/registrations",
                ).requiredMap("post")["description"] as String
        assertTrue(registration.contains("Renderer must not receive it"))
        assertTrue(registration.contains("immediately active opaque session"))
        val refresh = paths.requiredMap("/desktop/v1/auth/session/refresh").requiredMap("post")["description"] as String
        assertTrue(refresh.contains("rotates both tokens"))
        val create = paths.requiredMap("/desktop/v1/workspaces/{workspaceId}/projects").requiredMap("post")["description"] as String
        assertTrue(create.contains("Workspace OWNER"))
        assertTrue(create.contains("requestId"))
        assertTrue(create.contains("duplicate", ignoreCase = true))
        val list = paths.requiredMap("/desktop/v1/workspaces/{workspaceId}/projects").requiredMap("get")["description"] as String
        assertTrue(list.contains("ACTIVE or ARCHIVED"))
        assertTrue(list.contains("cursor"))
        val edit =
            paths
                .requiredMap(
                    "/desktop/v1/workspaces/{workspaceId}/projects/{projectId}",
                ).requiredMap("patch")["description"] as String
        assertTrue(edit.contains("Project OWNER"))
        assertTrue(edit.contains("expectedVersion"))
        val deletion =
            paths
                .requiredMap(
                    "/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/permanent-deletion",
                ).requiredMap("post")["description"] as String
        assertTrue(deletion.contains("irreversib", ignoreCase = true))
        assertTrue(deletion.contains("confirmationName"))
        assertTrue(deletion.contains("protected dependenc", ignoreCase = true))
    }

    private fun verifySharedComponents(document: Map<String, Any?>) {
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
        val bearer = document.requiredMap("components").requiredMap("securitySchemes").requiredMap("accessBearer")
        assertEquals("http", bearer["type"])
        assertEquals("bearer", bearer["scheme"])
        assertEquals("opaque", bearer["bearerFormat"])
    }

    private fun verifyNoLegacyPaths(paths: Map<String, Any?>) {
        legacyPaths.forEach { assertFalse(paths.containsKey(it), it) }
        paths.keys.forEach { path ->
            assertFalse(path.contains("deliveries"), path)
            assertFalse(path.contains("recoveries"), path)
            assertFalse(path.contains("members"), path)
            assertFalse(path.contains("memberships"), path)
            assertFalse(path.contains("teams"), path)
            assertFalse(path.contains("workflows"), path)
            assertFalse(path.contains("agents"), path)
        }
    }

    private fun verifyNoSecretExamples(
        document: Map<String, Any?>,
        rawDocument: String,
    ) {
        forbiddenSecretValues.forEach { assertFalse(rawDocument.contains(it), "OpenAPI leaked secret/example: $it") }
        visit(document) { key, value ->
            if (key in setOf("example", "examples", "default") && value is String) {
                assertFalse(secretPropertyNames.any { value.contains(it, ignoreCase = true) })
            }
        }
    }

    private fun visit(
        value: Any?,
        visitor: (String, Any?) -> Unit,
    ) {
        when (value) {
            is Map<*, *> -> {
                value.forEach { (key, child) ->
                    visitor(key.toString(), child)
                    visit(child, visitor)
                }
            }

            is Iterable<*> -> {
                value.forEach { visit(it, visitor) }
            }
        }
    }

    private fun Map<String, Any?>.requestSchema(): String? {
        val content = (this["requestBody"] as? Map<*, *>)?.get("content") as? Map<*, *> ?: return null
        val json = content["application/json"] as? Map<*, *> ?: return null
        return ((json["schema"] as? Map<*, *>)?.get("\$ref") as? String)?.substringAfterLast('/')
    }

    private fun Map<String, Any?>.problemSchema(status: String): String? {
        val response = requiredMap("responses").requiredMap(status)
        val problem = response.requiredMap("content").requiredMap("application/problem+json")
        return (problem.requiredMap("schema")["\$ref"] as? String)?.substringAfterLast('/')
    }

    private fun Map<String, Any?>.successSchema(): String? {
        val responses = requiredMap("responses")
        val success = responses.entries.firstOrNull { it.key.startsWith('2') }?.value as? Map<*, *> ?: return null
        val content = success["content"] as? Map<*, *> ?: return null
        val json = content["application/json"] as? Map<*, *> ?: return null
        val schema = json["schema"] as? Map<*, *> ?: return null
        val direct = (schema["\$ref"] as? String)?.substringAfterLast('/')
        if (direct != null) return direct
        val itemRef = ((schema["items"] as? Map<*, *>)?.get("\$ref") as? String)?.substringAfterLast('/')
        return itemRef?.let { "$it[]" }
    }

    private fun get(path: String): HttpResult {
        val connection = URI("http://127.0.0.1:$port$path").toURL().openConnection() as HttpURLConnection
        val status = connection.responseCode
        val body =
            (
                if (status >=
                    400
                ) {
                    connection.errorStream
                } else {
                    connection.inputStream
                }
            )?.bufferedReader()?.use { it.readText() }.orEmpty()
        connection.disconnect()
        return HttpResult(status, body)
    }

    private data class HttpResult(
        val status: Int,
        val body: String,
    )

    companion object {
        private val operations =
            mapOf(
                ("/desktop/v1/auth/capabilities" to "get") to
                    OperationContract(null, "AuthenticationCapabilitiesResponse", setOf("200"), "anonymous"),
                ("/desktop/v1/auth/federated/attempts" to "post") to
                    OperationContract(
                        "FederatedAttemptRequest",
                        "FederatedAttemptResponse",
                        setOf("201", "400", "429", "503"),
                        "anonymous",
                    ),
                ("/desktop/v1/auth/federated/github/callback" to "get") to
                    OperationContract(null, null, setOf("200", "400", "409", "503"), "anonymous"),
                ("/desktop/v1/auth/federated/attempts/{attemptId}/poll" to "post") to
                    OperationContract(
                        "FederatedPollRequest",
                        "FederatedPollResponse",
                        setOf("200", "400", "409", "410", "503"),
                        "anonymous",
                    ),
                ("/desktop/v1/auth/federated/attempts/{attemptId}/cancel" to "post") to
                    OperationContract(
                        "FederatedAttemptSecretRequest",
                        null,
                        setOf("204", "400", "409", "503"),
                        "anonymous",
                    ),
                ("/desktop/v1/auth/federated/registrations" to "post") to
                    OperationContract(
                        "FederatedRegistrationRequest",
                        "FederatedPollResponse",
                        setOf("201", "400", "409", "503"),
                        "anonymous",
                    ),
                ("/desktop/v1/auth/session/refresh" to "post") to
                    OperationContract(
                        "RefreshRequest",
                        "SessionResponse",
                        setOf("200", "400", "401", "503"),
                        "refresh-credential-body",
                    ),
                ("/desktop/v1/auth/session/logout" to "post") to
                    OperationContract(null, null, setOf("204", "401"), "access-bearer"),
                ("/desktop/v1/me" to "get") to
                    OperationContract(null, "CurrentUserResponse", setOf("200", "401"), "access-bearer"),
                ("/desktop/v1/workspaces" to "get") to
                    OperationContract(null, "PersonalWorkspaceResponse[]", setOf("200", "401", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects" to "get") to
                    OperationContract(null, "ProjectPage", setOf("200", "400", "401", "404", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects" to "post") to
                    OperationContract(
                        "CreateProjectRequest",
                        "ProjectView",
                        setOf("201", "400", "401", "404", "409", "503"),
                        "access-bearer",
                    ),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}" to "get") to
                    OperationContract(null, "ProjectView", setOf("200", "400", "401", "404", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}" to "patch") to
                    OperationContract(
                        "EditProjectRequest",
                        "ProjectView",
                        setOf("200", "400", "401", "404", "409", "503"),
                        "access-bearer",
                    ),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/archive" to "post") to
                    OperationContract(
                        "ProjectStatusRequest",
                        "ProjectView",
                        setOf("200", "400", "401", "404", "409", "503"),
                        "access-bearer",
                    ),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/restore" to "post") to
                    OperationContract(
                        "ProjectStatusRequest",
                        "ProjectView",
                        setOf("200", "400", "401", "404", "409", "503"),
                        "access-bearer",
                    ),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/permanent-deletion" to "post") to
                    OperationContract(
                        "DeleteProjectRequest",
                        null,
                        setOf("204", "400", "401", "404", "409", "503"),
                        "access-bearer",
                    ),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards" to "get") to
                    OperationContract(null, "BoardSummary[]", setOf("200", "400", "401", "404", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards" to "post") to
                    OperationContract("CreateBoardRequest", "BoardView", setOf("201", "400", "401", "404", "409", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}" to "get") to
                    OperationContract(null, "BoardView", setOf("200", "400", "401", "404", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}" to "patch") to
                    OperationContract("EditBoardRequest", "BoardView", setOf("200", "400", "401", "404", "409", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}/columns" to "post") to
                    OperationContract("CreateColumnRequest", "BoardView", setOf("201", "400", "401", "404", "409", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}/columns/{columnId}" to "patch") to
                    OperationContract("EditColumnRequest", "BoardView", setOf("200", "400", "401", "404", "409", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}/columns/{columnId}" to "delete") to
                    OperationContract(null, null, setOf("204", "400", "401", "404", "409", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}/column-order" to "put") to
                    OperationContract(
                        "ReorderColumnsRequest",
                        "BoardView",
                        setOf("200", "400", "401", "404", "409", "503"),
                        "access-bearer",
                    ),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}/work-items" to "post") to
                    OperationContract(
                        "CreateWorkItemRequest",
                        "CreateWorkItemResult",
                        setOf("201", "400", "401", "404", "409", "503"),
                        "access-bearer",
                    ),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/work-items/{workItemId}" to "get") to
                    OperationContract(null, "WorkItemView", setOf("200", "400", "401", "404", "503"), "access-bearer"),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/work-items/{workItemId}" to "patch") to
                    OperationContract(
                        "EditWorkItemRequest",
                        "EditWorkItemResult",
                        setOf("200", "400", "401", "404", "409", "503"),
                        "access-bearer",
                    ),
                ("/desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}/placements/{workItemId}/move" to "post") to
                    OperationContract(
                        "MovePlacementRequest",
                        "BoardView",
                        setOf("200", "400", "401", "404", "409", "503"),
                        "access-bearer",
                    ),
            )
        private val legacyPaths =
            setOf(
                "/desktop/v1/auth/registration/code",
                "/desktop/v1/auth/registration/code/verify",
                "/desktop/v1/auth/registration",
                "/desktop/v1/auth/login/password",
                "/desktop/v1/auth/login/code",
                "/desktop/v1/auth/login/code/verify",
                "/desktop/v1/auth/password-reset/code",
                "/desktop/v1/auth/password-reset/code/verify",
                "/desktop/v1/auth/password-reset",
            )
        private val secretPropertyNames = setOf("secret", "token", "proof", "nonce", "continuation")
        private val forbiddenSecretValues =
            setOf(
                "openapi-completion-proof-sentinel",
                "openapi-continuation-secret-sentinel",
                "openapi-access-token-sentinel",
                "openapi-refresh-token-sentinel",
                "openapi-github-client-secret-sentinel",
            )
        private const val COMPLETION_URI_PATTERN =
            "^http://127\\.0\\.0\\.1:(?:49(?:15[2-9]|1[6-9][0-9]|[2-9][0-9]{2})|5[0-9]{4}|" +
                "6(?:[0-4][0-9]{3}|5(?:[0-4][0-9]{2}|5(?:[0-2][0-9]|3[0-5]))))/taskpilot/oauth/complete/" +
                "[A-Za-z0-9_-]{32,128}$"
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }
        private val redis = OpenApiRedisContainer().withExposedPorts(6379).apply { start() }
        private val redisConnection =
            LettuceConnectionFactory(RedisStandaloneConfiguration(redis.host, redis.getMappedPort(6379))).also {
                it.afterPropertiesSet()
            }
        private val pepper = Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
        private val hmacKey = Base64.getEncoder().encodeToString(ByteArray(32) { 31 })
        private val aeadKey = Base64.getEncoder().encodeToString(ByteArray(32) { 63 })

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
            registry.add("spring.data.redis.host", redis::getHost)
            registry.add("spring.data.redis.port") { redis.getMappedPort(6379) }
            registry.add("taskpilot.authentication.enabled") { "true" }
            registry.add("taskpilot.authentication.token-pepper-base64") { pepper }
            registry.add("taskpilot.authentication.legal-bundle-version") { "2026-09" }
            registry.add("taskpilot.authentication.terms-version") { "terms-2026-09" }
            registry.add("taskpilot.authentication.privacy-version") { "privacy-2026-09" }
            registry.add("taskpilot.authentication.legal-locales") { "zh-CN,en" }
            registry.add("taskpilot.authentication.github.client-id") { "openapi-client-id" }
            registry.add("taskpilot.authentication.github.client-secret") { "openapi-github-client-secret-sentinel" }
            registry.add(
                "taskpilot.authentication.github.callback-uri",
            ) { "http://127.0.0.1:18080/desktop/v1/auth/federated/github/callback" }
            registry.add("taskpilot.authentication.github.hmac-key-base64") { hmacKey }
            registry.add("taskpilot.authentication.github.aead-key-base64") { aeadKey }
        }
    }
}

private class OpenApiRedisContainer : GenericContainer<OpenApiRedisContainer>("redis:7.4-alpine")
