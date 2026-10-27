package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.FederatedIdentityProvider
import ai.taskpilot.coreapi.access.application.ProviderIdentity
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.data.redis.connection.RedisStandaloneConfiguration
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory
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
@Suppress("LargeClass") // One fixture exercises the complete authenticated Desktop HTTP boundary.
class AuthenticationHttpIntegrationTest(
    @param:LocalServerPort private val port: Int,
) {
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
                "/desktop/v1/auth/federated/registrations",
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

        val me = request("GET", "/desktop/v1/me", bearer = accessToken)
        assertEquals(200, me.status)
        assertEquals("Octo Cat", me.json()["displayName"])

        val refreshed =
            request(
                "POST",
                "/desktop/v1/auth/session/refresh",
                """{"refreshToken":"$refreshToken"}""",
            )
        assertEquals(200, refreshed.status)
        val rotated = refreshed.json()
        assertNotEquals(accessToken, rotated.requiredText("accessToken"))
        assertNotEquals(refreshToken, rotated.requiredText("refreshToken"))
        assertEquals(
            401,
            request("POST", "/desktop/v1/auth/session/refresh", """{"refreshToken":"$refreshToken"}""").status,
        )
        assertEquals(401, request("GET", "/desktop/v1/me", bearer = rotated.requiredText("accessToken")).status)
    }

    @Test
    fun `authenticated workspace and project API supports read create edit and stable failures`() {
        val registered = registerAccount()

        val workspaces = request("GET", "/desktop/v1/workspaces", bearer = registered.accessToken)
        assertEquals(200, workspaces.status)
        assertEquals(registered.workspaceId, workspaces.jsonList().single().requiredText("workspaceId"))
        assertEquals("PERSONAL", workspaces.jsonList().single().requiredText("type"))
        assertEquals("OWNER", workspaces.jsonList().single().requiredText("role"))

        val listed = request("GET", "/desktop/v1/workspaces/${registered.workspaceId}/projects", bearer = registered.accessToken)
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
                "/desktop/v1/workspaces/${registered.workspaceId}/projects",
                """{"requestId":"$requestId","name":" New project ","description":" Notes "}""",
                registered.accessToken,
            )
        assertEquals(201, created.status)
        assertEquals("New project", created.json().requiredText("name"))
        val projectId = created.json().requiredText("projectId")

        val replay =
            request(
                "POST",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects",
                """{"requestId":"$requestId","name":"New project","description":"Notes"}""",
                registered.accessToken,
            )
        assertEquals(201, replay.status)
        assertEquals(projectId, replay.json().requiredText("projectId"))

        val idempotencyConflict =
            request(
                "POST",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects",
                """{"requestId":"$requestId","name":"Changed","description":"Notes"}""",
                registered.accessToken,
            )
        assertProblem(idempotencyConflict, 409, "IDEMPOTENCY_CONFLICT")

        val edited =
            request(
                "PATCH",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects/$projectId",
                """{"expectedVersion":0,"name":"Renamed","description":null}""",
                registered.accessToken,
            )
        assertEquals(200, edited.status)
        assertEquals("Renamed", edited.json().requiredText("name"))
        assertEquals("1", edited.json().requiredText("version"))

        val stale =
            request(
                "PATCH",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects/$projectId",
                """{"expectedVersion":0,"name":"Stale","description":null}""",
                registered.accessToken,
            )
        assertProblem(stale, 409, "PROJECT_VERSION_CONFLICT")

        val archived =
            request(
                "POST",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects/$projectId/archive",
                """{"expectedVersion":1}""",
                registered.accessToken,
            )
        assertEquals(200, archived.status)
        assertEquals("ARCHIVED", archived.json().requiredText("status"))
        assertEquals("2", archived.json().requiredText("version"))
        val archiveReplay =
            request(
                "POST",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects/$projectId/archive",
                """{"expectedVersion":1}""",
                registered.accessToken,
            )
        assertEquals(archived.body, archiveReplay.body)
        assertProblem(
            request(
                "POST",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects/$projectId/restore",
                """{"expectedVersion":1}""",
                registered.accessToken,
            ),
            409,
            "PROJECT_VERSION_CONFLICT",
        )
        val restored =
            request(
                "POST",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects/$projectId/restore",
                """{"expectedVersion":2}""",
                registered.accessToken,
            )
        assertEquals(200, restored.status)
        assertEquals("ACTIVE", restored.json().requiredText("status"))
        assertProblem(
            request(
                "POST",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects/$projectId/permanent-deletion",
                """{"expectedVersion":3,"confirmationName":"Wrong"}""",
                registered.accessToken,
            ),
            409,
            "PROJECT_NAME_CONFIRMATION_MISMATCH",
        )
        val deleted =
            request(
                "POST",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects/$projectId/permanent-deletion",
                """{"expectedVersion":3,"confirmationName":"Renamed"}""",
                registered.accessToken,
            )
        assertEquals(204, deleted.status)
        assertEquals("", deleted.body)
        assertProblem(
            request(
                "GET",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects/$projectId",
                bearer = registered.accessToken,
            ),
            404,
            "PROJECT_NOT_FOUND",
        )

        val invalid =
            request(
                "POST",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects",
                """{"requestId":"${java.util.UUID.randomUUID()}","name":" ","description":null}""",
                registered.accessToken,
            )
        assertProblem(invalid, 400, "VALIDATION_FAILED")
        assertEquals("name", invalid.json().requiredText("path"))

        assertEquals(401, request("GET", "/desktop/v1/workspaces").status)
        val unknownWorkspace = java.util.UUID.randomUUID()
        assertProblem(
            request(
                "GET",
                "/desktop/v1/workspaces/$unknownWorkspace/projects",
                bearer = registered.accessToken,
            ),
            404,
            "PROJECT_NOT_FOUND",
        )
        assertProblem(
            request(
                "GET",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects/${java.util.UUID.randomUUID()}",
                bearer = registered.accessToken,
            ),
            404,
            "PROJECT_NOT_FOUND",
        )
        val invalidLimit =
            request(
                "GET",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects?limit=0",
                bearer = registered.accessToken,
            )
        assertProblem(invalidLimit, 400, "VALIDATION_FAILED")
        assertEquals("limit", invalidLimit.json().requiredText("path"))
        val invalidStatus =
            request(
                "GET",
                "/desktop/v1/workspaces/${registered.workspaceId}/projects?status=UNKNOWN",
                bearer = registered.accessToken,
            )
        assertProblem(invalidStatus, 400, "VALIDATION_FAILED")
        assertEquals("status", invalidStatus.json().requiredText("path"))
    }

    @Test
    fun `authenticated project work API enforces scope versions and stable transport semantics`() {
        val registered = registerAccount()
        val root = "/desktop/v1/workspaces/${registered.workspaceId}/projects/${registered.projectId}"

        assertEquals(401, request("GET", "$root/boards").status)
        val initialBoards = request("GET", "$root/boards", bearer = registered.accessToken)
        assertEquals(200, initialBoards.status)
        val initialBoardId = initialBoards.jsonList().single().requiredText("boardId")
        val initialBoard = request("GET", "$root/boards/$initialBoardId", bearer = registered.accessToken)
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
                "$root/boards/$boardId/columns",
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
                "$root/boards/$boardId/work-items",
                """
                {"requestId":"$itemRequestId","expectedBoardVersion":1,"columnId":"$firstColumnId",
                "title":" Task ","description":" Detail "}
                """.trimIndent(),
                registered.accessToken,
            )
        assertEquals(201, createdItem.status)
        val workItemId = createdItem.json().nested("workItem").requiredText("workItemId")
        assertEquals(
            setOf("workItemId", "projectId", "title", "description", "version", "createdAt", "updatedAt"),
            createdItem.json().nested("workItem").keys,
        )
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
                "$root/boards/$boardId/work-items",
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
                "$root/boards/$boardId/work-items",
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
                "$root/boards/$boardId/placements/$workItemId/move",
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
            setOf("workItemId", "title", "description", "workItemVersion", "placementVersion", "position"),
            movedCard.keys,
        )

        val editedItem =
            request(
                "PATCH",
                "$root/work-items/$workItemId",
                """
                {"boardId":"$boardId","currentColumnId":"$secondColumnId",
                "targetColumnId":"$secondColumnId","expectedVersion":0,
                "title":"Updated","description":null}
                """.trimIndent(),
                registered.accessToken,
            )
        assertEquals(200, editedItem.status)
        assertEquals("Updated", editedItem.json().nested("workItem").requiredText("title"))
        val itemKeys = setOf("workItemId", "projectId", "title", "description", "version", "createdAt", "updatedAt")
        val cardKeys = setOf("workItemId", "title", "description", "workItemVersion", "placementVersion", "position")
        assertEquals(itemKeys, editedItem.json().nested("workItem").keys)
        val detail = request("GET", "$root/work-items/$workItemId", bearer = registered.accessToken)
        assertEquals(200, detail.status)
        assertEquals(itemKeys, detail.json().keys)
        val readBoard = request("GET", "$root/boards/$boardId", bearer = registered.accessToken)
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
        assertEquals(
            "Updated",
            request(
                "GET",
                "$root/boards/$boardId",
                bearer = registered.accessToken,
            ).json().listOfObjects("columns").last().listOfObjects("cards").single().requiredText("title"),
        )

        val missingBoardVersion =
            request(
                "PATCH",
                "$root/work-items/$workItemId",
                """
                {"boardId":"$boardId","currentColumnId":"$secondColumnId",
                "targetColumnId":"$firstColumnId","expectedPlacementVersion":1,"expectedVersion":1,
                "title":"Must not move","description":null}
                """.trimIndent(),
                registered.accessToken,
            )
        assertProblem(missingBoardVersion, 400, "VALIDATION_FAILED")
        assertEquals("expectedBoardVersion", missingBoardVersion.json().requiredText("path"))

        val missingPlacementVersion =
            request(
                "PATCH",
                "$root/work-items/$workItemId",
                """
                {"boardId":"$boardId","currentColumnId":"$secondColumnId",
                "targetColumnId":"$firstColumnId","expectedBoardVersion":3,"expectedVersion":1,
                "title":"Must not move","description":null}
                """.trimIndent(),
                registered.accessToken,
            )
        assertProblem(missingPlacementVersion, 400, "VALIDATION_FAILED")
        assertEquals("expectedPlacementVersion", missingPlacementVersion.json().requiredText("path"))

        assertProblem(
            request(
                "DELETE",
                "$root/boards/$boardId/columns/$secondColumnId?expectedBoardVersion=3&expectedColumnVersion=0",
                bearer = registered.accessToken,
            ),
            409,
            "COLUMN_NOT_EMPTY",
        )

        val nonEmptyDeletionPath = "$root/boards/$boardId/permanent-deletion"
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
        val disposableDeletionPath = "$root/boards/$disposableBoardId/permanent-deletion"
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
            request("GET", "$root/boards/$disposableBoardId", bearer = registered.accessToken),
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
                    "$root/boards/$protectedBoardId/permanent-deletion",
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
        assertProblem(
            request(
                "GET",
                "/desktop/v1/workspaces/${java.util.UUID.randomUUID()}/projects/${registered.projectId}/boards/$boardId",
                bearer = registered.accessToken,
            ),
            404,
            "PROJECT_NOT_FOUND",
        )
        assertEquals(405, request("DELETE", "$root/boards/$boardId", bearer = registered.accessToken).status)
        assertEquals(405, request("DELETE", "$root/work-items/$workItemId", bearer = registered.accessToken).status)
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
                "/desktop/v1/auth/federated/registrations",
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
                "/desktop/v1/auth/federated/attempts/${created.requiredText("attemptId")}/cancel",
                """{"pollSecret":"${created.requiredText("pollSecret")}"}""",
            )
        assertEquals(204, cancelled.status)
        assertEquals("CANCELLED", poll(created, null).json()["status"])
        val state = URI(created.requiredText("authorizationUrl")).queryParameters().getValue("state")
        assertEquals(
            409,
            request("GET", "/desktop/v1/auth/federated/github/callback?state=${encode(state)}&code=late").status,
        )
    }

    @Test
    fun `attempt validates loopback completion URI and rate limits one installation`() {
        val invalid =
            request(
                "POST",
                "/desktop/v1/auth/federated/attempts",
                """{"provider":"github","installationId":"desktop-test","completionUri":"https://example.com/callback"}""",
            )
        assertEquals(400, invalid.status)
        repeat(5) {
            assertEquals(201, request("POST", "/desktop/v1/auth/federated/attempts", attemptBody("desktop-$it")).status)
        }
        val limited = request("POST", "/desktop/v1/auth/federated/attempts", attemptBody("desktop-over-limit"))
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
                "/desktop/v1/auth/federated/registrations",
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
                "/desktop/v1/auth/federated/registrations",
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

    private fun registerAccount(): RegisteredAccount {
        val completed = completeAttempt()
        val preview = poll(completed.created, completed.proof).json().nested("registration")
        val response = request("POST", "/desktop/v1/auth/federated/registrations", registrationBody(preview))
        assertEquals(201, response.status)
        val body = response.json()
        return RegisteredAccount(
            body.nested("session").requiredText("accessToken"),
            body.nested("bootstrap").requiredText("workspaceId"),
            body.nested("bootstrap").requiredText("projectId"),
        )
    }

    private fun assertProblem(
        response: HttpResult,
        status: Int,
        code: String,
    ) {
        assertEquals(status, response.status)
        assertEquals(code, response.json().requiredText("code"))
    }

    private fun completeAttempt(): CompletedAttempt {
        val created = createAttempt()
        val state = URI(created.requiredText("authorizationUrl")).queryParameters().getValue("state")
        val callback = request("GET", "/desktop/v1/auth/federated/github/callback?state=${encode(state)}&code=code-1")
        assertEquals(200, callback.status)
        assertTrue(callback.body.contains("window.close()"))
        val proof =
            Regex("""const proof = "([^"]+)"""").find(callback.body)?.groupValues?.get(1)
                ?: error("missing completion proof")
        return CompletedAttempt(created, proof)
    }

    private fun createAttempt(): Map<String, Any?> {
        val response = request("POST", "/desktop/v1/auth/federated/attempts", attemptBody("desktop-test"))
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
            "/desktop/v1/auth/federated/attempts/${created.requiredText("attemptId")}/poll",
            """{"pollSecret":"${created.requiredText(
                "pollSecret",
            )}"${proof?.let { ",\"completionProof\":\"$it\"" }.orEmpty()}}""",
        )

    private fun request(
        method: String,
        path: String,
        body: String? = null,
        bearer: String? = null,
    ): HttpResult {
        val request =
            HttpRequest
                .newBuilder(URI("http://127.0.0.1:$port$path"))
                .header("Content-Type", "application/json")
                .apply { bearer?.let { header("Authorization", "Bearer $it") } }
                .method(
                    method,
                    body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody(),
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
        private const val CALLBACK_URI = "http://127.0.0.1:18080/desktop/v1/auth/federated/github/callback"
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
                "123456",
                "Octo Cat",
                URI("https://avatars.githubusercontent.com/u/123456"),
            )
        }
}

private fun encodeQuery(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")
