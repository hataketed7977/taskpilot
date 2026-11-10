package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.FederatedIdentityProvider
import ai.taskpilot.coreapi.access.application.HmacSha256SecretDigester
import ai.taskpilot.coreapi.access.application.ProviderIdentity
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.access.application.SessionUser
import ai.taskpilot.coreapi.access.model.UserId
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.data.redis.connection.RedisStandaloneConfiguration
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.GenericContainer
import org.testcontainers.postgresql.PostgreSQLContainer
import tools.jackson.core.type.TypeReference
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    classes = [CoreApiApplication::class, FakeFederatedProviderConfiguration::class],
)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@Suppress("LargeClass", "MaxLineLength") // Inline JSON keeps the real HTTP payloads reviewable.
class AuthenticationHttpIntegrationTest(
    @param:LocalServerPort private val port: Int,
) {
    @Autowired
    private lateinit var sessions: SessionUseCases
    private val objectMapper = ObjectMapper()
    private lateinit var redisConnection: LettuceConnectionFactory

    @BeforeAll
    fun migrateSchema() {
        Flyway
            .configure()
            .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
            .locations("classpath:db/migration")
            .load()
            .migrate()
        redisConnection = LettuceConnectionFactory(RedisStandaloneConfiguration(redis.host, redis.getMappedPort(6379)))
        redisConnection.afterPropertiesSet()
    }

    @BeforeEach
    fun clearState() {
        postgres.createConnection("").use { connection ->
            connection.createStatement().use {
                it.execute(
                    "TRUNCATE access.terms_acceptances, access.external_identities, access.users CASCADE",
                )
            }
        }
        redisConnection.connection.serverCommands().flushAll()
    }

    @AfterAll
    fun stopContainers() {
        redisConnection.destroy()
        redis.stop()
        postgres.stop()
    }

    @Test
    fun `logout strictly selects a credential and rejects malformed bodies before Redis lookup`() {
        val issued = sessions.issue(SessionUser(UserId(UUID.randomUUID()), "Ada", null))
        val invalid =
            listOf(
                "null",
                "[]",
                "true",
                "1",
                "\"token\"",
                "{\"extra\":1}",
                "{} {}",
                "{\"refreshToken\":\"${issued.refreshToken}\"} null",
                "{\"refreshToken\":null}",
                "{\"refreshToken\":1}",
                "{\"refreshToken\":\"\"}",
                "{\"refreshToken\":\"${"😀".repeat(513)}\"}",
                "{\"refreshToken\":\"${issued.refreshToken}\",\"extra\":1}",
            )
        invalid.forEach { body ->
            val response = request("POST", "/v1/session:logout", body, issued.accessToken)
            assertEquals(400, response.status, body)
            assertEquals("VALIDATION_FAILED", response.json().requiredText("code"))
            assertEquals(200, request("GET", "/v1/me", bearer = issued.accessToken).status)
        }
        assertEquals(400, request("POST", "/v1/session:logout", """{"refreshToken":"${issued.refreshToken}"}""", "invalid").status)
        listOf(null, "{}").forEach { body ->
            assertEquals(401, request("POST", "/v1/session:logout", body).status)
            assertEquals(401, request("POST", "/v1/session:logout", body, "bad token").status)
        }
        assertEquals(204, request("POST", "/v1/session:logout", """{"refreshToken":"${"😀".repeat(512)}"}""").status)
        assertEquals(204, request("POST", "/v1/session:logout", """{"refreshToken":"${issued.refreshToken}"}""").status)
        assertEquals(401, request("GET", "/v1/me", bearer = issued.accessToken).status)
        assertEquals(204, request("POST", "/v1/session:logout", """{"refreshToken":"${issued.refreshToken}"}""").status)
        listOf(null, "{}").forEach { body ->
            val legacy = sessions.issue(SessionUser(UserId(UUID.randomUUID()), "Ada", null))
            assertEquals(204, request("POST", "/v1/session:logout", body, legacy.accessToken).status)
            assertEquals(401, request("POST", "/v1/session:refresh", """{"refreshToken":"${legacy.refreshToken}"}""").status)
        }
    }

    @Test
    fun `logout Redis failure uses generic 503 while malformed payload remains 400`() {
        val template = StringRedisTemplate(redisConnection).also { it.afterPropertiesSet() }
        val digester = HmacSha256SecretDigester(ByteArray(32) { 7 })
        // A wrong Redis type gives a real DataAccessException without stopping the shared server.
        val digest = digester.digest("session:refresh", "broken").encoded
        template.opsForHash<String, String>().put("taskpilot:auth:refresh:$digest", "bad", "type")
        val result = request("POST", "/v1/session:logout", """{"refreshToken":"broken"}""")
        assertEquals(503, result.status)
        assertEquals("TEMPORARILY_UNAVAILABLE", result.json().requiredText("code"))
        assertEquals(400, request("POST", "/v1/session:logout", "null", "broken").status)
    }

    @Test
    fun `authentication wire constraints remain enforced without generated Bean Validation`() {
        assertValidation(
            request("POST", "/v1/session:refresh", """{"refreshToken":"${"x".repeat(513)}"}"""),
            "refreshToken",
        )
        val attemptId = UUID.randomUUID()
        assertValidation(
            request("POST", "/v1/federated-login-attempts/$attemptId:poll", """{"pollSecret":""}"""),
            "pollSecret",
        )
        assertValidation(
            request("POST", "/v1/federated-login-attempts/$attemptId:cancel", """{"pollSecret":""}"""),
            "pollSecret",
        )

        val completed = completeAttempt()
        val preview = poll(completed.created, completed.proof).json().nested("registration")
        listOf(
            "continuationSecret" to registrationBody(preview + ("continuationSecret" to "x".repeat(513))),
            "legalBundleVersion" to registrationBody(preview, legalBundleVersion = "x".repeat(129)),
            "termsVersion" to registrationBody(preview, termsVersion = "x".repeat(129)),
            "privacyVersion" to registrationBody(preview, privacyVersion = "x".repeat(129)),
            "locale" to registrationBody(preview, locale = "x".repeat(36)),
        ).forEach { (path, body) ->
            assertValidation(request("POST", "/v1/federated-registrations", body), path)
        }
    }

    @Test
    fun `work item creation accepts omitted and explicit null assignees as unassigned`() {
        val account = registerAccount()
        val board = firstBoard(account).json()
        val boardId = board.requiredText("boardId")
        val columnId = board.listOfObjects("columns").single().requiredText("columnId")

        val omitted =
            request(
                "POST",
                "/v1/boards/$boardId/work-items",
                """{"requestId":"${UUID.randomUUID()}","expectedBoardVersion":0,"columnId":"$columnId","title":"Omitted"}""",
                account.accessToken,
            )
        assertEquals(201, omitted.status)
        assertNull(omitted.json().nested("workItem")["assignee"])

        val explicitNull =
            request(
                "POST",
                "/v1/boards/$boardId/work-items",
                """{"requestId":"${UUID.randomUUID()}","expectedBoardVersion":1,"columnId":"$columnId","title":"Null","assignee":null}""",
                account.accessToken,
            )
        assertEquals(201, explicitNull.status)
        assertNull(explicitNull.json().nested("workItem")["assignee"])
    }

    @Test
    fun `first GitHub sign in registers and returns an immediately active session`() {
        val completed = completeAttempt()
        val pending = poll(completed.created, completed.proof)
        assertEquals("REGISTRATION_REQUIRED", pending.json()["status"])
        val registration = pending.json().nested("registration")
        assertEquals("2026-09", registration.requiredText("legalBundleVersion"))
        assertEquals("terms-2026-09", registration.requiredText("termsVersion"))
        assertEquals("privacy-2026-09", registration.requiredText("privacyVersion"))
        assertEquals(listOf("zh-CN", "en"), registration["legalLocales"])

        val authenticated =
            request(
                "POST",
                "/v1/federated-registrations",
                """
                {
                  "continuationId":"${registration.requiredText("continuationId")}",
                  "continuationSecret":"${registration.requiredText("continuationSecret")}",
                  "displayName":"Octo Cat",
                  "useSuggestedAvatar":true,
                  "legalBundleVersion":"2026-09",
                  "termsVersion":"terms-2026-09",
                  "privacyVersion":"privacy-2026-09",
                  "locale":"zh-CN"
                }
                """.trimIndent(),
            )
        assertEquals(201, authenticated.status)
        assertEquals("AUTHENTICATED", authenticated.json()["status"])
        val authenticatedBody = authenticated.json()
        val bootstrap = authenticatedBody.nested("bootstrap")
        assertProvisionedHomepage(
            bootstrap.requiredText("workspaceId"),
            bootstrap.requiredText("projectId"),
            "我的项目",
        )
        val session = authenticatedBody.nested("session")
        val accessToken = session.requiredText("accessToken")
        val refreshToken = session.requiredText("refreshToken")

        val me = request("GET", "/v1/me", bearer = accessToken)
        assertEquals(200, me.status)
        assertEquals("Octo Cat", me.json()["displayName"])

        val refreshed =
            request(
                "POST",
                "/v1/session:refresh",
                """{"refreshToken":"$refreshToken"}""",
            )
        assertEquals(200, refreshed.status)
        val rotated = refreshed.json()
        assertNotEquals(accessToken, rotated.requiredText("accessToken"))
        assertNotEquals(refreshToken, rotated.requiredText("refreshToken"))
        assertEquals(
            401,
            request("POST", "/v1/session:refresh", """{"refreshToken":"$refreshToken"}""").status,
        )
        assertEquals(401, request("GET", "/v1/me", bearer = rotated.requiredText("accessToken")).status)
    }

    @Test
    fun `authenticated workspace and project API supports read create edit and stable failures`() {
        val registered = registerAccount()

        val workspaces = request("GET", "/v1/workspaces", bearer = registered.accessToken)
        assertEquals(200, workspaces.status)
        assertEquals(registered.workspaceId, workspaces.jsonList().single().requiredText("workspaceId"))
        assertEquals("PERSONAL", workspaces.jsonList().single().requiredText("type"))
        assertEquals("OWNER", workspaces.jsonList().single().requiredText("role"))

        val listed = request("GET", "/v1/workspaces/${registered.workspaceId}/projects", bearer = registered.accessToken)
        assertEquals(200, listed.status)
        assertEquals(
            registered.projectId,
            listed
                .json()
                .listOfObjects("items")
                .single()
                .requiredText("projectId"),
        )

        val requestId = java.util.UUID.randomUUID()
        val created =
            request(
                "POST",
                "/v1/workspaces/${registered.workspaceId}/projects",
                """{"requestId":"$requestId","name":" New project ","description":" Notes "}""",
                registered.accessToken,
            )
        assertEquals(201, created.status)
        assertEquals("New project", created.json().requiredText("name"))
        val projectId = created.json().requiredText("projectId")

        val replay =
            request(
                "POST",
                "/v1/workspaces/${registered.workspaceId}/projects",
                """{"requestId":"$requestId","name":"New project","description":"Notes"}""",
                registered.accessToken,
            )
        assertEquals(201, replay.status)
        assertEquals(projectId, replay.json().requiredText("projectId"))

        val idempotencyConflict =
            request(
                "POST",
                "/v1/workspaces/${registered.workspaceId}/projects",
                """{"requestId":"$requestId","name":"Changed","description":"Notes"}""",
                registered.accessToken,
            )
        assertProblem(idempotencyConflict, 409, "IDEMPOTENCY_CONFLICT")

        val edited =
            request(
                "PATCH",
                "/v1/projects/$projectId",
                """{"expectedVersion":0,"name":"Renamed"}""",
                registered.accessToken,
            )
        assertEquals(200, edited.status, edited.body)
        assertEquals("Renamed", edited.json().requiredText("name"))
        assertEquals("1", edited.json().requiredText("version"))

        val stale =
            request(
                "PATCH",
                "/v1/projects/$projectId",
                """{"expectedVersion":0,"name":"Stale"}""",
                registered.accessToken,
            )
        assertProblem(stale, 409, "PROJECT_VERSION_CONFLICT")

        val archived =
            request(
                "POST",
                "/v1/projects/$projectId:archive",
                """{"expectedVersion":1}""",
                registered.accessToken,
            )
        assertEquals(200, archived.status)
        assertEquals("ARCHIVED", archived.json().requiredText("status"))
        assertEquals("2", archived.json().requiredText("version"))
        val archiveReplay =
            request(
                "POST",
                "/v1/projects/$projectId:archive",
                """{"expectedVersion":1}""",
                registered.accessToken,
            )
        assertEquals(archived.body, archiveReplay.body)
        assertProblem(
            request(
                "POST",
                "/v1/projects/$projectId:restore",
                """{"expectedVersion":1}""",
                registered.accessToken,
            ),
            409,
            "PROJECT_VERSION_CONFLICT",
        )
        val restored =
            request(
                "POST",
                "/v1/projects/$projectId:restore",
                """{"expectedVersion":2}""",
                registered.accessToken,
            )
        assertEquals(200, restored.status)
        assertEquals("ACTIVE", restored.json().requiredText("status"))
        assertProblem(
            request(
                "POST",
                "/v1/projects/$projectId:permanentlyDelete",
                """{"expectedVersion":3,"confirmationName":"Wrong"}""",
                registered.accessToken,
            ),
            409,
            "PROJECT_NAME_CONFIRMATION_MISMATCH",
        )
        val deleted =
            request(
                "POST",
                "/v1/projects/$projectId:permanentlyDelete",
                """{"expectedVersion":3,"confirmationName":"Renamed"}""",
                registered.accessToken,
            )
        assertEquals(204, deleted.status)
        assertEquals("", deleted.body)
        assertProblem(
            request(
                "GET",
                "/v1/projects/$projectId",
                bearer = registered.accessToken,
            ),
            404,
            "PROJECT_NOT_FOUND",
        )

        val invalid =
            request(
                "POST",
                "/v1/workspaces/${registered.workspaceId}/projects",
                """{"requestId":"${java.util.UUID.randomUUID()}","name":" ","description":null}""",
                registered.accessToken,
            )
        assertProblem(invalid, 400, "VALIDATION_FAILED")
        assertEquals("name", invalid.json().requiredText("path"))

        assertEquals(401, request("GET", "/v1/workspaces").status)
        val unknownWorkspace = java.util.UUID.randomUUID()
        assertProblem(
            request(
                "GET",
                "/v1/workspaces/$unknownWorkspace/projects",
                bearer = registered.accessToken,
            ),
            404,
            "PROJECT_NOT_FOUND",
        )
        assertProblem(
            request(
                "GET",
                "/v1/projects/${java.util.UUID.randomUUID()}",
                bearer = registered.accessToken,
            ),
            404,
            "PROJECT_NOT_FOUND",
        )
        val invalidLimit =
            request(
                "GET",
                "/v1/workspaces/${registered.workspaceId}/projects?limit=0",
                bearer = registered.accessToken,
            )
        assertProblem(invalidLimit, 400, "VALIDATION_FAILED")
        assertEquals("limit", invalidLimit.json().requiredText("path"))
        val invalidStatus =
            request(
                "GET",
                "/v1/workspaces/${registered.workspaceId}/projects?status=UNKNOWN",
                bearer = registered.accessToken,
            )
        assertProblem(invalidStatus, 400, "VALIDATION_FAILED")
        assertEquals("status", invalidStatus.json().requiredText("path"))
    }

    @Test
    fun `authenticated project work API enforces scope versions and stable transport semantics`() {
        val registered = registerAccount()
        val root = "/v1/projects/${registered.projectId}"
        val ownerMemberId = projectMemberId(registered.projectId, "Octo Cat")
        val zedMemberId = insertProjectMember(registered.projectId, "Zed Assignee")
        val adaMemberId = insertProjectMember(registered.projectId, "Ada Assignee")
        insertProjectMember(registered.projectId, "Inactive Assignee", status = "DISABLED")
        val outsider = registerAccount("project-work-outsider")
        val outsiderMemberId = insertProjectMember(outsider.projectId, "Other Project Assignee")

        assertEquals(401, request("GET", "$root/members").status)
        val members = request("GET", "$root/members", bearer = registered.accessToken)
        assertEquals(200, members.status)
        val memberSummaries = members.json().listOfObjects("members")
        assertEquals(
            listOf(adaMemberId, ownerMemberId, zedMemberId).map(UUID::toString),
            memberSummaries.map { it.requiredText("projectMemberId") },
        )
        assertFalse(memberSummaries.any { it.requiredText("projectMemberId") == outsiderMemberId.toString() })
        memberSummaries.forEach { member ->
            assertEquals(setOf("projectMemberId", "user", "role", "createdAt"), member.keys)
            assertEquals("OWNER", member.requiredText("role"))
            assertEquals(setOf("userId", "displayName", "avatarUrl"), member.nested("user").keys)
        }
        assertEquals(404, request("GET", "/v1/projects/${outsider.projectId}/members", bearer = registered.accessToken).status)
        assertEquals(405, request("POST", "$root/members", "{}", registered.accessToken).status)
        assertEquals(404, request("GET", "$root/assignee-agents", bearer = registered.accessToken).status)

        assertEquals(401, request("GET", "$root/boards").status)
        val initialBoards = request("GET", "$root/boards", bearer = registered.accessToken)
        assertEquals(200, initialBoards.status)
        val initialBoardId = initialBoards.jsonList().single().requiredText("boardId")
        val initialBoard = request("GET", "/v1/boards/$initialBoardId", bearer = registered.accessToken)
        assertEquals(200, initialBoard.status)
        assertEquals("工作看板", initialBoard.json().requiredText("name"))

        val boardRequestId = java.util.UUID.randomUUID()
        val createdBoard =
            request(
                "POST",
                "$root/boards",
                """{"requestId":"$boardRequestId","name":" Delivery ","description":" Notes ","locale":"en"}""",
                registered.accessToken,
            )
        assertEquals(201, createdBoard.status)
        val boardId = createdBoard.json().requiredText("boardId")
        val firstColumn = createdBoard.json().listOfObjects("columns").single()
        assertEquals("To do", firstColumn.requiredText("name"))
        val firstColumnId = firstColumn.requiredText("columnId")

        val boardReplay =
            request(
                "POST",
                "$root/boards",
                """{"requestId":"$boardRequestId","name":"Delivery","description":"Notes","locale":"en"}""",
                registered.accessToken,
            )
        assertEquals(201, boardReplay.status)
        assertEquals(boardId, boardReplay.json().requiredText("boardId"))
        assertProblem(
            request(
                "POST",
                "$root/boards",
                """{"requestId":"$boardRequestId","name":"Changed","description":"Notes","locale":"en"}""",
                registered.accessToken,
            ),
            409,
            "IDEMPOTENCY_CONFLICT",
        )

        val secondColumn =
            request(
                "POST",
                "/v1/boards/$boardId/columns",
                """{"requestId":"${java.util.UUID.randomUUID()}","expectedBoardVersion":0,"name":"Done"}""",
                registered.accessToken,
            )
        assertEquals(201, secondColumn.status)
        val secondColumnId =
            secondColumn
                .json()
                .listOfObjects("columns")
                .last()
                .requiredText("columnId")

        val itemRequestId = java.util.UUID.randomUUID()
        val createdItem =
            request(
                "POST",
                "/v1/boards/$boardId/work-items",
                """
                {"requestId":"$itemRequestId","expectedBoardVersion":1,"columnId":"$firstColumnId",
                "title":" Task ","description":" Detail "}
                """.trimIndent(),
                registered.accessToken,
            )
        assertEquals(201, createdItem.status)
        val workItemId = createdItem.json().nested("workItem").requiredText("workItemId")
        assertEquals(
            setOf("workItemId", "projectId", "title", "description", "version", "createdAt", "updatedAt", "createdBy", "assignee"),
            createdItem.json().nested("workItem").keys,
        )
        assertEquals(
            "Octo Cat",
            createdItem
                .json()
                .nested("workItem")
                .nested("createdBy")
                .requiredText("displayName"),
        )
        assertNull(createdItem.json().nested("workItem")["assignee"])
        assertEquals(
            workItemId,
            createdItem
                .json()
                .nested("board")
                .listOfObjects("columns")
                .first()
                .listOfObjects("cards")
                .single()
                .requiredText("workItemId"),
        )

        val itemReplay =
            request(
                "POST",
                "/v1/boards/$boardId/work-items",
                """
                {"requestId":"$itemRequestId","expectedBoardVersion":1,"columnId":"$firstColumnId",
                "title":"Task","description":"Detail"}
                """.trimIndent(),
                registered.accessToken,
            )
        assertEquals(201, itemReplay.status)
        assertEquals(workItemId, itemReplay.json().nested("workItem").requiredText("workItemId"))
        assertProblem(
            request(
                "POST",
                "/v1/boards/$boardId/work-items",
                """
                {"requestId":"${java.util.UUID.randomUUID()}","expectedBoardVersion":1,
                "columnId":"$firstColumnId","title":"Stale","description":null}
                """.trimIndent(),
                registered.accessToken,
            ),
            409,
            "BOARD_VERSION_CONFLICT",
        )

        val moved =
            request(
                "POST",
                "/v1/boards/$boardId/placements/$workItemId:move",
                """{"expectedBoardVersion":2,"expectedPlacementVersion":0,"targetColumnId":"$secondColumnId","beforeWorkItemId":null}""",
                registered.accessToken,
            )
        assertEquals(200, moved.status)
        val movedCard =
            moved
                .json()
                .listOfObjects("columns")
                .last()
                .listOfObjects("cards")
                .single()
        assertEquals("1", movedCard.requiredText("placementVersion"))
        assertEquals(
            setOf("workItemId", "title", "description", "workItemVersion", "placementVersion", "position", "assignee"),
            movedCard.keys,
        )
        assertNull(movedCard["assignee"])

        val editedItem =
            request(
                "PATCH",
                "/v1/work-items/$workItemId",
                """
                {"boardId":"$boardId","currentColumnId":"$secondColumnId",
                "targetColumnId":"$secondColumnId","expectedVersion":0,
                "title":"Updated",
                "assigneePatch":{"action":"SET","target":{"targetType":"PROJECT_MEMBER","projectMemberId":"$adaMemberId"}}}
                """.trimIndent(),
                registered.accessToken,
            )
        assertEquals(200, editedItem.status)
        assertEquals("Updated", editedItem.json().nested("workItem").requiredText("title"))
        val itemKeys =
            setOf("workItemId", "projectId", "title", "description", "version", "createdAt", "updatedAt", "createdBy", "assignee")
        val cardKeys =
            setOf("workItemId", "title", "description", "workItemVersion", "placementVersion", "position", "assignee")
        assertEquals(itemKeys, editedItem.json().nested("workItem").keys)
        val editedAssignee = editedItem.json().nested("workItem").nested("assignee")
        assertEquals("PROJECT_MEMBER", editedAssignee.requiredText("targetType"))
        assertEquals(adaMemberId.toString(), editedAssignee.requiredText("projectMemberId"))
        assertEquals("Ada Assignee", editedAssignee.nested("user").requiredText("displayName"))
        val detail = request("GET", "/v1/work-items/$workItemId", bearer = registered.accessToken)
        assertEquals(200, detail.status)
        assertEquals(itemKeys, detail.json().keys)
        assertEquals(adaMemberId.toString(), detail.json().nested("assignee").requiredText("projectMemberId"))
        val readBoard = request("GET", "/v1/boards/$boardId", bearer = registered.accessToken)
        assertEquals(200, readBoard.status)
        assertEquals(
            cardKeys,
            readBoard
                .json()
                .listOfObjects("columns")
                .last()
                .listOfObjects("cards")
                .single()
                .keys,
        )

        assertEquals(boardId, editedItem.json().nested("board").requiredText("boardId"))
        val updatedCard =
            request(
                "GET",
                "/v1/boards/$boardId",
                bearer = registered.accessToken,
            ).json().listOfObjects("columns").last().listOfObjects("cards").single()
        assertEquals("Updated", updatedCard.requiredText("title"))
        assertEquals(adaMemberId.toString(), updatedCard.nested("assignee").requiredText("projectMemberId"))

        val missingBoardVersion =
            request(
                "PATCH",
                "/v1/work-items/$workItemId",
                """
                {"boardId":"$boardId","currentColumnId":"$secondColumnId",
                "targetColumnId":"$firstColumnId","expectedPlacementVersion":1,"expectedVersion":1,
                "title":"Must not move"}
                """.trimIndent(),
                registered.accessToken,
            )
        assertProblem(missingBoardVersion, 400, "VALIDATION_FAILED")
        assertEquals("expectedBoardVersion", missingBoardVersion.json().requiredText("path"))

        val missingPlacementVersion =
            request(
                "PATCH",
                "/v1/work-items/$workItemId",
                """
                {"boardId":"$boardId","currentColumnId":"$secondColumnId",
                "targetColumnId":"$firstColumnId","expectedBoardVersion":3,"expectedVersion":1,
                "title":"Must not move"}
                """.trimIndent(),
                registered.accessToken,
            )
        assertProblem(missingPlacementVersion, 400, "VALIDATION_FAILED")
        assertEquals("expectedPlacementVersion", missingPlacementVersion.json().requiredText("path"))

        assertProblem(
            request(
                "DELETE",
                "/v1/columns/$secondColumnId?expectedBoardVersion=3&expectedColumnVersion=0",
                bearer = registered.accessToken,
            ),
            409,
            "COLUMN_NOT_EMPTY",
        )

        val nonEmptyDeletionPath = "/v1/boards/$boardId:permanentlyDelete"
        assertProblem(
            request(
                "POST",
                nonEmptyDeletionPath,
                """{"expectedVersion":2,"confirmationName":"Delivery"}""",
                registered.accessToken,
            ),
            409,
            "BOARD_VERSION_CONFLICT",
        )
        assertProblem(
            request(
                "POST",
                nonEmptyDeletionPath,
                """{"expectedVersion":3,"confirmationName":" Delivery "}""",
                registered.accessToken,
            ),
            409,
            "BOARD_NAME_CONFIRMATION_MISMATCH",
        )
        assertProblem(
            request(
                "POST",
                nonEmptyDeletionPath,
                """{"expectedVersion":3,"confirmationName":"Delivery"}""",
                registered.accessToken,
            ),
            409,
            "BOARD_NOT_EMPTY",
        )

        val disposableBoard =
            request(
                "POST",
                "$root/boards",
                """{"requestId":"${java.util.UUID.randomUUID()}","name":"Disposable","description":null,"locale":"en"}""",
                registered.accessToken,
            )
        assertEquals(201, disposableBoard.status)
        val disposableBoardId = disposableBoard.json().requiredText("boardId")
        val disposableDeletionPath = "/v1/boards/$disposableBoardId:permanentlyDelete"
        assertEquals(
            401,
            request(
                "POST",
                disposableDeletionPath,
                """{"expectedVersion":0,"confirmationName":"Disposable"}""",
            ).status,
        )
        val deleted =
            request(
                "POST",
                disposableDeletionPath,
                """{"expectedVersion":0,"confirmationName":"Disposable"}""",
                registered.accessToken,
            )
        assertNotEquals(405, deleted.status)
        assertEquals(204, deleted.status)
        assertFalse(
            request("GET", "$root/boards", bearer = registered.accessToken)
                .jsonList()
                .any { it.requiredText("boardId") == disposableBoardId },
        )
        assertProblem(
            request("GET", "/v1/boards/$disposableBoardId", bearer = registered.accessToken),
            404,
            "PROJECT_NOT_FOUND",
        )

        val protectedBoard =
            request(
                "POST",
                "$root/boards",
                """{"requestId":"${java.util.UUID.randomUUID()}","name":"Protected","description":null,"locale":"en"}""",
                registered.accessToken,
            )
        assertEquals(201, protectedBoard.status)
        val protectedBoardId = protectedBoard.json().requiredText("boardId")
        postgres.createConnection("").use { connection ->
            connection.createStatement().use { statement ->
                statement.execute(
                    """
                    CREATE TABLE project.board_delete_http_test_guards (
                        board_id UUID PRIMARY KEY REFERENCES project.boards(id) ON DELETE RESTRICT
                    )
                    """.trimIndent(),
                )
                statement.execute(
                    "INSERT INTO project.board_delete_http_test_guards (board_id) VALUES ('$protectedBoardId')",
                )
            }
        }
        try {
            assertProblem(
                request(
                    "POST",
                    "/v1/boards/$protectedBoardId:permanentlyDelete",
                    """{"expectedVersion":0,"confirmationName":"Protected"}""",
                    registered.accessToken,
                ),
                409,
                "BOARD_DELETE_RESTRICTED",
            )
        } finally {
            postgres.createConnection("").use { connection ->
                connection.createStatement().use { it.execute("DROP TABLE project.board_delete_http_test_guards") }
            }
        }
        assertEquals(
            404,
            request(
                "GET",
                "/v1/projects/${registered.projectId}/boards/$boardId",
                bearer = registered.accessToken,
            ).status,
        )
        assertEquals(405, request("DELETE", "/v1/boards/$boardId", bearer = registered.accessToken).status)
        assertEquals(405, request("DELETE", "/v1/work-items/$workItemId", bearer = registered.accessToken).status)
    }

    @Test
    @Suppress("ktlint:standard:max-line-length") // Full wire payloads remain literal boundary fixtures.
    fun `complete maximum Unicode create and SET edit fit raw and escaped HTTP budgets`() {
        val account = registerAccount("unicode-owner")
        val board = firstBoard(account).json()
        val boardId = board.requiredText("boardId")
        val columnId = board.listOfObjects("columns").single().requiredText("columnId")
        val title = "😀".repeat(160)
        listOf(
            "😀".repeat(5000),
            java.text.Normalizer
                .normalize("ᾂ", java.text.Normalizer.Form.NFD)
                .repeat(5000),
        ).forEach { description ->
            listOf(false, true).forEach { escaped ->
                val version = request("GET", "/v1/boards/$boardId", bearer = account.accessToken).json().requiredText("version")
                val raw = """{"requestId":"${UUID.randomUUID()}","expectedBoardVersion":$version,"columnId":"$columnId","title":"$title","description":"$description"}"""
                val body = if (escaped) unicodeEscaped(raw) else raw
                assertTrue(body.toByteArray(StandardCharsets.UTF_8).size < 131072)
                val created = request("POST", "/v1/boards/$boardId/work-items", body, account.accessToken)
                assertEquals(201, created.status)
                val item = created.json().nested("workItem")
                val itemId = item.requiredText("workItemId")
                assertEquals(java.text.Normalizer.normalize(description, java.text.Normalizer.Form.NFC), item.requiredText("description"))
                val editDescription =
                    if (description.startsWith(
                            "😀",
                        )
                    ) {
                        "😁".repeat(5000)
                    } else {
                        java.text.Normalizer
                            .normalize("ᾃ", java.text.Normalizer.Form.NFD)
                            .repeat(5000)
                    }
                val patch = """{"boardId":"$boardId","currentColumnId":"$columnId","targetColumnId":"$columnId","expectedVersion":0,"title":"$title","descriptionPatch":{"action":"SET","value":"$editDescription"}}"""
                val edited = request("PATCH", "/v1/work-items/$itemId", if (escaped) unicodeEscaped(patch) else patch, account.accessToken)
                assertEquals(200, edited.status, edited.body)
            }
        }
    }

    @Test
    fun `real known length and chunked requests accept exact budget and reject budget plus one without effects`() {
        val account = registerAccount("byte-owner")
        val path = "/v1/projects/${account.projectId}"
        listOf(false, true).forEachIndexed { index, chunked ->
            val base = """{"expectedVersion":$index,"name":""}"""
            val body = base.replace("\"name\":\"\"", "\"name\":\"${" ".repeat(131072 - base.length - 1)}${if (index == 0) "X" else "Y"}\"")
            assertEquals(131072, body.toByteArray(StandardCharsets.UTF_8).size)
            val accepted = request("PATCH", path, body, account.accessToken, chunked)
            assertEquals(200, accepted.status, accepted.body)
            val over = body.replace("\"name\":\"", "\"name\":\" ")
            assertEquals(413, request("PATCH", path, over, account.accessToken, chunked).status)
            assertEquals((index + 1).toString(), request("GET", path, bearer = account.accessToken).json().requiredText("version"))
        }
    }

    private fun unicodeEscaped(value: String) =
        value
            .map { character ->
                if (character.code > 127) "\\u%04x".format(character.code) else character.toString()
            }.joinToString("")

    @Test
    fun `real HTTP text boundaries and sparse edits preserve historical values`() {
        val account = registerAccount("text-boundary-owner")
        val historicalProjectName = "p".repeat(ProductTextLimits.PROJECT_NAME + 1)
        val historicalProjectDescription = "d".repeat(ProductTextLimits.PROJECT_DESCRIPTION + 1)
        updateProjectText(account.projectId, historicalProjectName, historicalProjectDescription)

        val readableProject = request("GET", "/v1/projects/${account.projectId}", bearer = account.accessToken)
        assertEquals(200, readableProject.status)
        assertEquals(historicalProjectName, readableProject.json().requiredText("name"))
        assertEquals(historicalProjectDescription, readableProject.json().requiredText("description"))

        val sparseProjectEdit =
            request(
                "PATCH",
                "/v1/projects/${account.projectId}",
                """{"expectedVersion":0,"descriptionPatch":{"action":"SET","value":"short"}}""",
                account.accessToken,
            )
        assertEquals(200, sparseProjectEdit.status)
        assertEquals(historicalProjectName, sparseProjectEdit.json().requiredText("name"))
        assertEquals("short", sparseProjectEdit.json().requiredText("description"))
        assertValidation(
            request(
                "PATCH",
                "/v1/projects/${account.projectId}",
                """{"expectedVersion":1,"name":"$historicalProjectName"}""",
                account.accessToken,
            ),
            "name",
        )
        assertEquals("1", request("GET", "/v1/projects/${account.projectId}", bearer = account.accessToken).json().requiredText("version"))

        val board = firstBoard(account).json()
        val boardId = board.requiredText("boardId")
        val columnId = board.listOfObjects("columns").single().requiredText("columnId")
        val historicalBoardName = "b".repeat(ProductTextLimits.BOARD_NAME + 1)
        val historicalBoardDescription = "d".repeat(ProductTextLimits.BOARD_DESCRIPTION + 1)
        updateBoardText(boardId, historicalBoardName, historicalBoardDescription)

        val readableBoard = request("GET", "/v1/boards/$boardId", bearer = account.accessToken)
        assertEquals(historicalBoardName, readableBoard.json().requiredText("name"))
        assertEquals(historicalBoardDescription, readableBoard.json().requiredText("description"))
        val sparseBoardEdit =
            request(
                "PATCH",
                "/v1/boards/$boardId",
                """{"expectedVersion":0,"descriptionPatch":{"action":"SET","value":"short"}}""",
                account.accessToken,
            )
        assertEquals(200, sparseBoardEdit.status)
        assertEquals(historicalBoardName, sparseBoardEdit.json().requiredText("name"))
        assertEquals("short", sparseBoardEdit.json().requiredText("description"))
        assertValidation(
            request(
                "PATCH",
                "/v1/boards/$boardId",
                """{"expectedVersion":1,"name":"$historicalBoardName"}""",
                account.accessToken,
            ),
            "name",
        )

        val exactTitle = "😀".repeat(ProductTextLimits.WORK_ITEM_TITLE)
        val created =
            request(
                "POST",
                "/v1/boards/$boardId/work-items",
                """{"requestId":"${UUID.randomUUID()}","expectedBoardVersion":1,"columnId":"$columnId","title":"$exactTitle","description":null}""",
                account.accessToken,
            )
        assertEquals(201, created.status)
        val workItemId = created.json().nested("workItem").requiredText("workItemId")
        assertEquals(exactTitle, created.json().nested("workItem").requiredText("title"))

        assertValidation(
            request(
                "POST",
                "/v1/boards/$boardId/work-items",
                """{"requestId":"${UUID.randomUUID()}","expectedBoardVersion":2,"columnId":"$columnId","title":"$exactTitle😀","description":null}""",
                account.accessToken,
            ),
            "title",
        )
        val afterRejectedCreate = request("GET", "/v1/boards/$boardId", bearer = account.accessToken).json()
        assertEquals("2", afterRejectedCreate.requiredText("version"))
        assertEquals(
            1,
            afterRejectedCreate
                .listOfObjects("columns")
                .single()
                .listOfObjects("cards")
                .size,
        )

        val historicalTitle = "t".repeat(ProductTextLimits.WORK_ITEM_TITLE + 1)
        val historicalDescription = "d".repeat(ProductTextLimits.WORK_ITEM_DESCRIPTION + 1)
        updateWorkItemText(workItemId, historicalTitle, historicalDescription)
        val historicalItem = request("GET", "/v1/work-items/$workItemId", bearer = account.accessToken)
        assertEquals(historicalTitle, historicalItem.json().requiredText("title"))
        assertEquals(historicalDescription, historicalItem.json().requiredText("description"))

        val ownerMemberId = projectMemberId(account.projectId, "Octo Cat")
        val assigneeOnly =
            request(
                "PATCH",
                "/v1/work-items/$workItemId",
                """{"boardId":"$boardId","currentColumnId":"$columnId","targetColumnId":"$columnId","expectedVersion":0,"assigneePatch":{"action":"SET","target":{"targetType":"PROJECT_MEMBER","projectMemberId":"$ownerMemberId"}}}""",
                account.accessToken,
            )
        assertEquals(200, assigneeOnly.status)
        assertEquals(historicalTitle, assigneeOnly.json().nested("workItem").requiredText("title"))
        assertEquals(historicalDescription, assigneeOnly.json().nested("workItem").requiredText("description"))
        assertValidation(
            request(
                "PATCH",
                "/v1/work-items/$workItemId",
                """{"boardId":"$boardId","currentColumnId":"$columnId","targetColumnId":"$columnId","expectedVersion":1,"title":"$historicalTitle"}""",
                account.accessToken,
            ),
            "title",
        )
        assertValidation(
            request(
                "PATCH",
                "/v1/work-items/$workItemId",
                """{"boardId":"$boardId","currentColumnId":"$columnId","targetColumnId":"$columnId","expectedVersion":1,"descriptionPatch":{"action":"SET","value":"$historicalDescription"}}""",
                account.accessToken,
            ),
            "descriptionPatch.value",
        )
        val unchangedItem = request("GET", "/v1/work-items/$workItemId", bearer = account.accessToken).json()
        assertEquals("1", unchangedItem.requiredText("version"))
        assertEquals(historicalTitle, unchangedItem.requiredText("title"))
        assertEquals(historicalDescription, unchangedItem.requiredText("description"))

        val exactEditedTitle = "x".repeat(ProductTextLimits.WORK_ITEM_TITLE)
        val exactEdit =
            request(
                "PATCH",
                "/v1/work-items/$workItemId",
                """{"boardId":"$boardId","currentColumnId":"$columnId","targetColumnId":"$columnId","expectedVersion":1,"title":"$exactEditedTitle"}""",
                account.accessToken,
            )
        assertEquals(200, exactEdit.status)
        assertEquals(exactEditedTitle, exactEdit.json().nested("workItem").requiredText("title"))
        assertEquals("2", exactEdit.json().nested("workItem").requiredText("version"))
        assertValidation(
            request(
                "PATCH",
                "/v1/work-items/$workItemId",
                """{"boardId":"$boardId","currentColumnId":"$columnId","targetColumnId":"$columnId","expectedVersion":2,"title":"${exactEditedTitle}x"}""",
                account.accessToken,
            ),
            "title",
        )
        val afterRejectedEdit = request("GET", "/v1/work-items/$workItemId", bearer = account.accessToken).json()
        assertEquals(exactEditedTitle, afterRejectedEdit.requiredText("title"))
        assertEquals("2", afterRejectedEdit.requiredText("version"))
    }

    @Test
    fun `real HTTP sparse mutations reject null illegal and no-op payloads atomically`() {
        val account = registerAccount("sparse-mutation-owner")
        val projectPath = "/v1/projects/${account.projectId}"
        val project = request("GET", projectPath, bearer = account.accessToken).json()
        val projectName = project.requiredText("name")

        assertValidation(
            request(
                "PATCH",
                projectPath,
                """{"expectedVersion":0,"name":null,"descriptionPatch":{"action":"SET","value":"must-not-save"}}""",
                account.accessToken,
            ),
            "name",
        )
        assertValidation(
            request("PATCH", projectPath, """{"expectedVersion":0,"name":"must-not-save","descriptionPatch":null}""", account.accessToken),
            "descriptionPatch",
        )
        assertValidation(
            request(
                "PATCH",
                projectPath,
                """{"expectedVersion":0,"descriptionPatch":{"action":"SET","value":null}}""",
                account.accessToken,
            ),
            "descriptionPatch.value",
        )
        assertValidation(
            request(
                "PATCH",
                projectPath,
                """{"expectedVersion":0,"descriptionPatch":{"action":"CLEAR","value":"illegal"}}""",
                account.accessToken,
            ),
            "descriptionPatch.value",
        )
        assertValidation(request("PATCH", projectPath, """{"expectedVersion":0}""", account.accessToken), "mutation")
        assertValidation(
            request("PATCH", projectPath, """{"expectedVersion":0,"name":"$projectName"}""", account.accessToken),
            "mutation",
        )
        val setProjectDescription =
            request(
                "PATCH",
                projectPath,
                """{"expectedVersion":0,"descriptionPatch":{"action":"SET","value":"project detail"}}""",
                account.accessToken,
            )
        assertEquals(200, setProjectDescription.status)
        val clearProjectDescription =
            request(
                "PATCH",
                projectPath,
                """{"expectedVersion":1,"descriptionPatch":{"action":"CLEAR"}}""",
                account.accessToken,
            )
        assertEquals(200, clearProjectDescription.status)
        assertEquals("", clearProjectDescription.json().requiredText("description"))

        val board = firstBoard(account).json()
        val boardId = board.requiredText("boardId")
        val boardName = board.requiredText("name")
        val columnId = board.listOfObjects("columns").single().requiredText("columnId")
        val created =
            request(
                "POST",
                "/v1/boards/$boardId/work-items",
                """{"requestId":"${UUID.randomUUID()}","expectedBoardVersion":0,"columnId":"$columnId","title":"Item","description":null}""",
                account.accessToken,
            )
        assertEquals(201, created.status)
        val workItemId = created.json().nested("workItem").requiredText("workItemId")
        val boardPath = "/v1/boards/$boardId"

        assertValidation(
            request(
                "PATCH",
                boardPath,
                """{"expectedVersion":1,"name":null,"descriptionPatch":{"action":"SET","value":"must-not-save"}}""",
                account.accessToken,
            ),
            "name",
        )
        assertValidation(
            request("PATCH", boardPath, """{"expectedVersion":1,"name":"must-not-save","descriptionPatch":null}""", account.accessToken),
            "descriptionPatch",
        )
        assertValidation(
            request(
                "PATCH",
                boardPath,
                """{"expectedVersion":1,"descriptionPatch":{"action":"SET","value":null}}""",
                account.accessToken,
            ),
            "descriptionPatch.value",
        )
        assertValidation(
            request(
                "PATCH",
                boardPath,
                """{"expectedVersion":1,"descriptionPatch":{"action":"CLEAR","value":"illegal"}}""",
                account.accessToken,
            ),
            "descriptionPatch.value",
        )
        assertValidation(request("PATCH", boardPath, """{"expectedVersion":1}""", account.accessToken), "mutation")
        assertValidation(
            request("PATCH", boardPath, """{"expectedVersion":1,"name":"$boardName"}""", account.accessToken),
            "mutation",
        )
        assertEquals(
            200,
            request(
                "PATCH",
                boardPath,
                """{"expectedVersion":1,"descriptionPatch":{"action":"SET","value":"board detail"}}""",
                account.accessToken,
            ).status,
        )
        val clearedBoard =
            request(
                "PATCH",
                boardPath,
                """{"expectedVersion":2,"descriptionPatch":{"action":"CLEAR"}}""",
                account.accessToken,
            )
        assertEquals(200, clearedBoard.status)
        assertEquals("", clearedBoard.json().requiredText("description"))

        val ownerMemberId = projectMemberId(account.projectId, "Octo Cat")
        val itemPath = "/v1/work-items/$workItemId"

        fun editItem(
            mutation: String,
            expectedVersion: Int = 0,
        ): HttpResult =
            request(
                "PATCH",
                itemPath,
                """{"boardId":"$boardId","currentColumnId":"$columnId","targetColumnId":"$columnId","expectedVersion":$expectedVersion$mutation}""",
                account.accessToken,
            )

        assertValidation(
            editItem(
                ",\"title\":null,\"assigneePatch\":{\"action\":\"SET\",\"target\":{\"targetType\":\"PROJECT_MEMBER\",\"projectMemberId\":\"$ownerMemberId\"}}",
            ),
            "title",
        )
        assertValidation(editItem(",\"title\":\"must-not-save\",\"descriptionPatch\":null"), "descriptionPatch")
        assertValidation(editItem(",\"title\":\"must-not-save\",\"assigneePatch\":null"), "assigneePatch")
        assertValidation(editItem(",\"descriptionPatch\":{\"action\":\"SET\",\"value\":null}"), "descriptionPatch.value")
        assertValidation(
            editItem(",\"descriptionPatch\":{\"action\":\"CLEAR\",\"value\":\"illegal\"}"),
            "descriptionPatch.value",
        )
        assertValidation(editItem(",\"assigneePatch\":{\"action\":\"SET\",\"target\":null}"), "assigneePatch.target")
        assertValidation(
            editItem(
                ",\"assigneePatch\":{\"action\":\"CLEAR\",\"target\":{\"targetType\":\"PROJECT_MEMBER\",\"projectMemberId\":\"$ownerMemberId\"}}",
            ),
            "assigneePatch.target",
        )
        assertValidation(editItem(""), "mutation")
        assertValidation(editItem(",\"title\":\"Item\""), "mutation")
        assertNull(request("GET", itemPath, bearer = account.accessToken).json()["assignee"])

        assertEquals(200, editItem(",\"descriptionPatch\":{\"action\":\"SET\",\"value\":\"detail\"}").status)
        assertEquals(200, editItem(",\"descriptionPatch\":{\"action\":\"CLEAR\"}", expectedVersion = 1).status)
        assertEquals(
            200,
            editItem(
                ",\"assigneePatch\":{\"action\":\"SET\",\"target\":{\"targetType\":\"PROJECT_MEMBER\",\"projectMemberId\":\"$ownerMemberId\"}}",
                expectedVersion = 2,
            ).status,
        )
        assertEquals(200, editItem(",\"assigneePatch\":{\"action\":\"CLEAR\"}", expectedVersion = 3).status)

        val secondColumn =
            request(
                "POST",
                "/v1/boards/$boardId/columns",
                """{"requestId":"${UUID.randomUUID()}","expectedBoardVersion":3,"name":"Done"}""",
                account.accessToken,
            )
        assertEquals(201, secondColumn.status)
        val secondColumnId =
            secondColumn
                .json()
                .listOfObjects("columns")
                .last()
                .requiredText("columnId")
        val moved =
            request(
                "PATCH",
                itemPath,
                """{"boardId":"$boardId","currentColumnId":"$columnId","targetColumnId":"$secondColumnId","expectedBoardVersion":4,"expectedPlacementVersion":0,"expectedVersion":4}""",
                account.accessToken,
            )
        assertEquals(200, moved.status)
        assertEquals("4", moved.json().nested("workItem").requiredText("version"))
        assertEquals("5", moved.json().nested("board").requiredText("version"))
        assertValidation(
            request(
                "PATCH",
                itemPath,
                """{"boardId":"$boardId","currentColumnId":"$secondColumnId","targetColumnId":"$secondColumnId","expectedVersion":4,"title":"${"x".repeat(
                    ProductTextLimits.WORK_ITEM_TITLE + 1,
                )}"}""",
                account.accessToken,
            ),
            "title",
        )
        val authoritative = request("GET", itemPath, bearer = account.accessToken).json()
        assertEquals("4", authoritative.requiredText("version"))
        assertEquals("Item", authoritative.requiredText("title"))
        assertNull(authoritative["assignee"])
    }

    @Test
    fun `canonical stable id paths conceal cross account ownership and reject mixed placements without mutation`() {
        val owner = registerAccount("owner-a")
        val outsider = registerAccount("owner-b")
        val ownerBoard = firstBoard(owner)
        val outsiderBoard = firstBoard(outsider)
        val outsiderColumnId =
            outsiderBoard
                .json()
                .listOfObjects("columns")
                .single()
                .requiredText("columnId")
        val outsiderWorkItem =
            request(
                "POST",
                "/v1/boards/${outsiderBoard.json().requiredText("boardId")}/work-items",
                """{"requestId":"${java.util.UUID.randomUUID()}","expectedBoardVersion":0,""" +
                    """"columnId":"$outsiderColumnId","title":"Private","description":null}""",
                outsider.accessToken,
            )
        assertEquals(201, outsiderWorkItem.status)
        val outsiderWorkItemId = outsiderWorkItem.json().nested("workItem").requiredText("workItemId")

        listOf(
            ConcealedRequest("GET", "/v1/projects/${outsider.projectId}"),
            ConcealedRequest("GET", "/v1/boards/${outsiderBoard.json().requiredText("boardId")}"),
            ConcealedRequest(
                "PATCH",
                "/v1/columns/$outsiderColumnId",
                """{"expectedBoardVersion":1,"expectedColumnVersion":0,"name":"Hidden"}""",
            ),
            ConcealedRequest("GET", "/v1/work-items/$outsiderWorkItemId"),
        ).forEach { candidate ->
            val concealed = request(candidate.method, candidate.path, candidate.body, owner.accessToken)
            assertEquals(404, concealed.status, candidate.path)
            assertTrue(
                concealed.json().requiredText("code") in setOf("PROJECT_NOT_FOUND", "PROJECT_WORK_NOT_FOUND"),
                "${candidate.path} leaked a distinguishable authorization result: ${concealed.body}",
            )
        }

        val ownerBefore = request("GET", "/v1/boards/${ownerBoard.json().requiredText("boardId")}", bearer = owner.accessToken)
        val outsiderBefore =
            request(
                "GET",
                "/v1/boards/${outsiderBoard.json().requiredText("boardId")}",
                bearer = outsider.accessToken,
            )
        val ownerColumnId =
            ownerBefore
                .json()
                .listOfObjects("columns")
                .single()
                .requiredText("columnId")
        val mixedMove =
            request(
                "POST",
                "/v1/boards/${ownerBoard.json().requiredText("boardId")}/placements/$outsiderWorkItemId:move",
                """{"expectedBoardVersion":0,"expectedPlacementVersion":0,"targetColumnId":"$ownerColumnId","beforeWorkItemId":null}""",
                owner.accessToken,
            )
        assertEquals(404, mixedMove.status)
        assertTrue(
            mixedMove.json().requiredText("code") in setOf("PROJECT_NOT_FOUND", "PROJECT_WORK_NOT_FOUND"),
            mixedMove.body,
        )
        assertEquals(
            ownerBefore.body,
            request("GET", "/v1/boards/${ownerBoard.json().requiredText("boardId")}", bearer = owner.accessToken).body,
        )
        assertEquals(
            outsiderBefore.body,
            request(
                "GET",
                "/v1/boards/${outsiderBoard.json().requiredText("boardId")}",
                bearer = outsider.accessToken,
            ).body,
        )
    }

    @Test
    fun `approved locales persist the exact legal quadruple and invalid combinations write nothing`() {
        listOf("zh-CN", "en").forEach(::registerAndAssertLegalQuadruple)

        listOf(
            mapOf("locale" to "fr"),
            mapOf("legalBundleVersion" to "old"),
            mapOf("termsVersion" to "old"),
            mapOf("privacyVersion" to "old"),
        ).forEach(::assertLegalBundleRejected)
    }

    @Test
    fun `known external identity signs in without registration`() {
        val first = completeAttempt()
        val preview = poll(first.created, first.proof).json().nested("registration")
        val registered =
            request(
                "POST",
                "/v1/federated-registrations",
                registrationBody(preview),
            )
        assertEquals(201, registered.status)
        val registeredUserId =
            registered
                .json()
                .nested("session")
                .nested("currentUser")
                .requiredText("userId")

        val second = completeAttempt()
        val signedIn = poll(second.created, second.proof)
        assertEquals(200, signedIn.status)
        assertEquals("AUTHENTICATED", signedIn.json()["status"])
        assertEquals(
            registeredUserId,
            signedIn
                .json()
                .nested("session")
                .nested("currentUser")
                .requiredText("userId"),
        )
        assertNull(signedIn.json()["registration"])
        assertNull(signedIn.json()["bootstrap"])
    }

    @Test
    fun `cancel is terminal and clears the browser attempt`() {
        val created = createAttempt()
        val cancelled =
            request(
                "POST",
                "/v1/federated-login-attempts/${created.requiredText("attemptId")}:cancel",
                """{"pollSecret":"${created.requiredText("pollSecret")}"}""",
            )
        assertEquals(204, cancelled.status)
        assertEquals("CANCELLED", poll(created, null).json()["status"])
        val state = URI(created.requiredText("authorizationUrl")).queryParameters().getValue("state")
        assertEquals(
            409,
            request("GET", "/v1/provider-callbacks/github/oauth?state=${encode(state)}&code=late").status,
        )
    }

    @Test
    fun `attempt validates loopback completion URI and rate limits one installation`() {
        val invalid =
            request(
                "POST",
                "/v1/federated-login-attempts",
                """{"provider":"github","installationId":"desktop-test","completionUri":"https://example.com/callback"}""",
            )
        assertEquals(400, invalid.status)
        repeat(5) {
            assertEquals(201, request("POST", "/v1/federated-login-attempts", attemptBody("desktop-$it")).status)
        }
        val limited = request("POST", "/v1/federated-login-attempts", attemptBody("desktop-over-limit"))
        assertEquals(429, limited.status)
        assertTrue(limited.json().requiredText("code") == "AUTHENTICATION_RATE_LIMITED")
    }

    private fun assertProvisionedHomepage(
        workspaceId: String,
        projectId: String,
        expectedProjectName: String,
    ) {
        postgres.createConnection("").use { connection ->
            connection
                .prepareStatement(
                    """
                    SELECT w.type, wm.role AS workspace_role, p.name, p.description, p.status,
                           pm.role AS project_role
                    FROM workspace.workspaces w
                    JOIN workspace.workspace_memberships wm ON wm.workspace_id = w.id
                    JOIN project.projects p ON p.workspace_id = w.id
                    JOIN project.project_memberships pm ON pm.project_id = p.id AND pm.user_id = wm.user_id
                    WHERE w.id = ?::uuid AND p.id = ?::uuid
                    """.trimIndent(),
                ).use { statement ->
                    statement.setString(1, workspaceId)
                    statement.setString(2, projectId)
                    statement.executeQuery().use { rows ->
                        assertTrue(rows.next())
                        assertEquals("PERSONAL", rows.getString("type"))
                        assertEquals("OWNER", rows.getString("workspace_role"))
                        assertEquals(expectedProjectName, rows.getString("name"))
                        assertEquals("", rows.getString("description"))
                        assertEquals("ACTIVE", rows.getString("status"))
                        assertEquals("OWNER", rows.getString("project_role"))
                        assertFalse(rows.next())
                    }
                }
        }
    }

    private fun registerAndAssertLegalQuadruple(locale: String) {
        clearState()
        val completed = completeAttempt()
        val preview = poll(completed.created, completed.proof).json().nested("registration")
        val response =
            request(
                "POST",
                "/v1/federated-registrations",
                registrationBody(preview, locale = locale),
            )
        assertEquals(201, response.status)
        assertPersistedLegalQuadruple(locale)
    }

    private fun assertLegalBundleRejected(overrides: Map<String, String>) {
        clearState()
        val completed = completeAttempt()
        val preview = poll(completed.created, completed.proof).json().nested("registration")
        val response =
            request(
                "POST",
                "/v1/federated-registrations",
                registrationBody(
                    preview,
                    locale = overrides["locale"] ?: "zh-CN",
                    legalBundleVersion = overrides["legalBundleVersion"] ?: "2026-09",
                    termsVersion = overrides["termsVersion"] ?: "terms-2026-09",
                    privacyVersion = overrides["privacyVersion"] ?: "privacy-2026-09",
                ),
            )
        assertEquals(409, response.status)
        assertEquals("LEGAL_BUNDLE_REJECTED", response.json()["code"])
        listOf("users", "external_identities", "terms_acceptances").forEach { table ->
            assertEquals(0, persistedRowCount(table), table)
        }
    }

    private fun persistedRowCount(table: String): Int =
        postgres.createConnection("").use { connection ->
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT count(*) FROM access.$table").use { result ->
                    assertTrue(result.next())
                    result.getInt(1)
                }
            }
        }

    private fun assertPersistedLegalQuadruple(locale: String) {
        postgres.createConnection("").use { connection ->
            connection
                .prepareStatement(
                    "SELECT legal_bundle_version, terms_version, privacy_version, locale " +
                        "FROM access.terms_acceptances",
                ).use { statement ->
                    statement.executeQuery().use { result ->
                        assertTrue(result.next())
                        assertEquals("2026-09", result.getString("legal_bundle_version"))
                        assertEquals("terms-2026-09", result.getString("terms_version"))
                        assertEquals("privacy-2026-09", result.getString("privacy_version"))
                        assertEquals(locale, result.getString("locale"))
                        assertFalse(result.next())
                    }
                }
        }
    }

    private fun registerAccount(identity: String = "owner-default"): RegisteredAccount {
        val completed = completeAttempt(identity)
        val preview = poll(completed.created, completed.proof).json().nested("registration")
        val response = request("POST", "/v1/federated-registrations", registrationBody(preview))
        assertEquals(201, response.status)
        val body = response.json()
        return RegisteredAccount(
            body.nested("session").requiredText("accessToken"),
            body.nested("bootstrap").requiredText("workspaceId"),
            body.nested("bootstrap").requiredText("projectId"),
        )
    }

    private fun firstBoard(account: RegisteredAccount): HttpResult {
        val boards = request("GET", "/v1/projects/${account.projectId}/boards", bearer = account.accessToken)
        assertEquals(200, boards.status)
        val boardId = boards.jsonList().single().requiredText("boardId")
        return request("GET", "/v1/boards/$boardId", bearer = account.accessToken).also {
            assertEquals(200, it.status)
        }
    }

    private fun projectMemberId(
        projectId: String,
        displayName: String,
    ): UUID =
        postgres.createConnection("").use { connection ->
            connection
                .prepareStatement(
                    """
                    SELECT m.id
                    FROM project.project_memberships m
                    JOIN access.users u ON u.id = m.user_id
                    WHERE m.project_id = ?::uuid AND u.display_name = ?
                    ORDER BY m.id
                    LIMIT 1
                    """.trimIndent(),
                ).use { statement ->
                    statement.setString(1, projectId)
                    statement.setString(2, displayName)
                    statement.executeQuery().use { rows ->
                        assertTrue(rows.next())
                        UUID.fromString(rows.getString("id"))
                    }
                }
        }

    private fun insertProjectMember(
        projectId: String,
        displayName: String,
        status: String = "ACTIVE",
    ): UUID {
        val userId = UUID.randomUUID()
        val memberId = UUID.randomUUID()
        postgres.createConnection("").use { connection ->
            connection
                .prepareStatement(
                    "INSERT INTO access.users (id, display_name, status, created_at) VALUES (?, ?, ?, now())",
                ).use { statement ->
                    statement.setObject(1, userId)
                    statement.setString(2, displayName)
                    statement.setString(3, status)
                    statement.executeUpdate()
                }
            connection
                .prepareStatement(
                    """
                    INSERT INTO project.project_memberships (id, project_id, user_id, role, created_at)
                    VALUES (?, ?::uuid, ?, 'OWNER', now())
                    """.trimIndent(),
                ).use { statement ->
                    statement.setObject(1, memberId)
                    statement.setString(2, projectId)
                    statement.setObject(3, userId)
                    statement.executeUpdate()
                }
        }
        return memberId
    }

    private fun updateProjectText(
        projectId: String,
        name: String,
        description: String,
    ) {
        postgres.createConnection("").use { connection ->
            connection.prepareStatement("UPDATE project.projects SET name = ?, description = ? WHERE id = ?::uuid").use { statement ->
                statement.setString(1, name)
                statement.setString(2, description)
                statement.setString(3, projectId)
                assertEquals(1, statement.executeUpdate())
            }
        }
    }

    private fun updateBoardText(
        boardId: String,
        name: String,
        description: String,
    ) {
        postgres.createConnection("").use { connection ->
            connection.prepareStatement("UPDATE project.boards SET name = ?, description = ? WHERE id = ?::uuid").use { statement ->
                statement.setString(1, name)
                statement.setString(2, description)
                statement.setString(3, boardId)
                assertEquals(1, statement.executeUpdate())
            }
        }
    }

    private fun updateWorkItemText(
        workItemId: String,
        title: String,
        description: String,
    ) {
        postgres.createConnection("").use { connection ->
            connection.prepareStatement("UPDATE project.work_items SET title = ?, description = ? WHERE id = ?::uuid").use { statement ->
                statement.setString(1, title)
                statement.setString(2, description)
                statement.setString(3, workItemId)
                assertEquals(1, statement.executeUpdate())
            }
        }
    }

    private fun assertValidation(
        response: HttpResult,
        path: String,
    ) {
        assertProblem(response, 400, "VALIDATION_FAILED")
        assertEquals(path, response.json().requiredText("path"))
    }

    private fun assertProblem(
        response: HttpResult,
        status: Int,
        code: String,
    ) {
        assertEquals(status, response.status)
        assertEquals(code, response.json().requiredText("code"))
    }

    private fun completeAttempt(identity: String = "owner-default"): CompletedAttempt {
        val created = createAttempt()
        val state = URI(created.requiredText("authorizationUrl")).queryParameters().getValue("state")
        val callback = request("GET", "/v1/provider-callbacks/github/oauth?state=${encode(state)}&code=${encode(identity)}")
        assertEquals(200, callback.status)
        assertTrue(callback.body.contains("window.close()"))
        val proof =
            Regex("""const proof = "([^"]+)"""").find(callback.body)?.groupValues?.get(1)
                ?: error("missing completion proof")
        return CompletedAttempt(created, proof)
    }

    private fun createAttempt(): Map<String, Any?> {
        val response = request("POST", "/v1/federated-login-attempts", attemptBody("desktop-test"))
        assertEquals(201, response.status)
        return response.json()
    }

    private fun attemptBody(installationId: String) =
        """{"provider":"github","installationId":"$installationId","completionUri":"$VALID_COMPLETION_URI"}"""

    private fun registrationBody(
        preview: Map<String, Any?>,
        locale: String = "zh-CN",
        legalBundleVersion: String = "2026-09",
        termsVersion: String = "terms-2026-09",
        privacyVersion: String = "privacy-2026-09",
    ) = """
        {
          "continuationId":"${preview.requiredText("continuationId")}",
          "continuationSecret":"${preview.requiredText("continuationSecret")}",
          "displayName":"Octo Cat",
          "useSuggestedAvatar":true,
          "legalBundleVersion":"$legalBundleVersion",
          "termsVersion":"$termsVersion",
          "privacyVersion":"$privacyVersion",
          "locale":"$locale"
        }
        """.trimIndent()

    private fun poll(
        created: Map<String, Any?>,
        proof: String?,
    ): HttpResult =
        request(
            "POST",
            "/v1/federated-login-attempts/${created.requiredText("attemptId")}:poll",
            """{"pollSecret":"${created.requiredText(
                "pollSecret",
            )}"${proof?.let { ",\"completionProof\":\"$it\"" }.orEmpty()}}""",
        )

    private fun request(
        method: String,
        path: String,
        body: String? = null,
        bearer: String? = null,
        chunked: Boolean = false,
    ): HttpResult {
        val request =
            HttpRequest
                .newBuilder(URI("http://127.0.0.1:$port$path"))
                .header("Content-Type", "application/json")
                .apply { bearer?.let { header("Authorization", "Bearer $it") } }
                .method(
                    method,
                    when {
                        body == null -> {
                            HttpRequest.BodyPublishers.noBody()
                        }

                        chunked -> {
                            HttpRequest.BodyPublishers.ofInputStream {
                                java.io.ByteArrayInputStream(
                                    body.toByteArray(StandardCharsets.UTF_8),
                                )
                            }
                        }

                        else -> {
                            HttpRequest.BodyPublishers.ofString(body)
                        }
                    },
                ).build()
        val response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString())
        return HttpResult(response.statusCode(), response.body())
    }

    private fun HttpResult.json(): Map<String, Any?> = objectMapper.readValue(body, object : TypeReference<Map<String, Any?>>() {})

    private fun HttpResult.jsonList(): List<Map<String, Any?>> =
        objectMapper.readValue(body, object : TypeReference<List<Map<String, Any?>>>() {})

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.nested(name: String) = getValue(name) as Map<String, Any?>

    private fun Map<String, Any?>.requiredText(name: String) = requireNotNull(get(name)).toString()

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.listOfObjects(name: String) = getValue(name) as List<Map<String, Any?>>

    private fun URI.queryParameters() =
        query.split('&').associate { part ->
            part.substringBefore('=') to
                java.net.URLDecoder.decode(part.substringAfter('='), StandardCharsets.UTF_8)
        }

    private fun encode(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8)

    private data class ConcealedRequest(
        val method: String,
        val path: String,
        val body: String? = null,
    )

    private data class RegisteredAccount(
        val accessToken: String,
        val workspaceId: String,
        val projectId: String,
    )

    private data class CompletedAttempt(
        val created: Map<String, Any?>,
        val proof: String,
    )

    private data class HttpResult(
        val status: Int,
        val body: String,
    )

    companion object {
        private const val CALLBACK_URI = "http://127.0.0.1:18080/v1/provider-callbacks/github/oauth"
        private const val VALID_COMPLETION_URI = "http://127.0.0.1:49152/taskpilot/oauth/complete/abcdefghijklmnopqrstuvwxyzABCDEF"
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }
        private val redis = AuthRedisContainer().withExposedPorts(6379).apply { start() }
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
            registry.add("taskpilot.authentication.github.client-id") { "client-id" }
            registry.add("taskpilot.authentication.github.client-secret") { "client-secret" }
            registry.add("taskpilot.authentication.github.callback-uri") { CALLBACK_URI }
            registry.add("taskpilot.authentication.github.hmac-key-base64") { hmacKey }
            registry.add("taskpilot.authentication.github.aead-key-base64") { aeadKey }
        }
    }
}

private class AuthRedisContainer : GenericContainer<AuthRedisContainer>("redis:7.4-alpine")

@TestConfiguration(proxyBeanMethods = false)
class FakeFederatedProviderConfiguration {
    @Bean
    @Primary
    fun fakeFederatedIdentityProvider(): FederatedIdentityProvider =
        object : FederatedIdentityProvider {
            override fun authorizationUri(
                state: String,
                pkceChallenge: String,
            ): URI =
                URI(
                    "https://github.com/login/oauth/authorize?client_id=client-id&state=${encodeQuery(
                        state,
                    )}&code_challenge=${encodeQuery(pkceChallenge)}&code_challenge_method=S256",
                )

            override fun resolveIdentity(
                authorizationCode: String,
                pkceVerifier: String,
            ) = ProviderIdentity(
                "github",
                URI("https://github.com"),
                authorizationCode,
                "Octo Cat",
                URI("https://avatars.githubusercontent.com/u/123456"),
            )
        }
}

private fun encodeQuery(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")
