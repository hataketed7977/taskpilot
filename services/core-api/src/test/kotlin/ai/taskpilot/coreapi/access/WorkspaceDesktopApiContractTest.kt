package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.api.AuthenticationProblemException
import ai.taskpilot.coreapi.access.api.CreateWorkspaceRequest
import ai.taskpilot.coreapi.access.api.CurrentUserResponse
import ai.taskpilot.coreapi.access.api.DesktopPrincipal
import ai.taskpilot.coreapi.access.api.WorkspaceController
import ai.taskpilot.coreapi.access.application.CreateOrganizationWorkspace
import ai.taskpilot.coreapi.access.application.CreateWorkspaceResult
import ai.taskpilot.coreapi.access.application.ListAccessibleWorkspaces
import ai.taskpilot.coreapi.access.application.WorkspaceCreationDecision
import ai.taskpilot.coreapi.access.application.WorkspaceCreationPolicy
import ai.taskpilot.coreapi.access.application.WorkspaceStore
import ai.taskpilot.coreapi.access.application.WorkspaceStoreUnavailableException
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.Workspace
import ai.taskpilot.coreapi.access.model.WorkspaceId
import ai.taskpilot.coreapi.access.model.WorkspaceType
import java.lang.reflect.Modifier
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkspaceDesktopApiContractTest {
    private val actor = UserId(UUID.randomUUID())
    private val principal = DesktopPrincipal("secret", CurrentUserResponse(actor.value, "Owner", "owner@example.com"))

    @Test
    fun `list exposes exact item and list capability shape without role`() {
        val workspace = Workspace(WorkspaceId(UUID.randomUUID()), "Platform", WorkspaceType.ORGANIZATION)
        val controller = controller(StubStore(items = listOf(workspace)))

        val response = controller.list(principal)

        assertEquals(
            listOf("workspaceId", "name", "type"),
            response.items.single()::class.java.declaredFields
                .filterNot {
                    Modifier.isStatic(it.modifiers)
                }.map { it.name },
        )
        assertTrue(response.capabilities.canCreateWorkspace)
        assertNull(response.capabilities.createWorkspaceReasonCode)
    }

    @Test
    fun `create returns 201 then 200 for replay with fixed organization representation`() {
        val workspace = Workspace(WorkspaceId(UUID.randomUUID()), "Platform", WorkspaceType.ORGANIZATION)
        val created =
            controller(
                StubStore(createResult = CreateWorkspaceResult.Created(workspace)),
            ).create(principal, "key", CreateWorkspaceRequest("Platform"))
        val replayed =
            controller(
                StubStore(createResult = CreateWorkspaceResult.Replayed(workspace)),
            ).create(principal, "key", CreateWorkspaceRequest("Platform"))

        assertEquals(201, created.statusCode.value())
        assertEquals(200, replayed.statusCode.value())
        assertEquals("ORGANIZATION", created.body?.type)
        assertEquals(workspace.workspaceId.value, replayed.body?.workspaceId)
    }

    @Test
    fun `invalid name and idempotency conflict map to stable problems`() {
        val invalid =
            assertFailsWith<AuthenticationProblemException> {
                controller(StubStore()).create(principal, "key", CreateWorkspaceRequest("bad\nname"))
            }
        assertEquals("VALIDATION_FAILED", invalid.code)
        assertEquals("name", invalid.path)

        val conflict =
            assertFailsWith<AuthenticationProblemException> {
                controller(StubStore(createResult = CreateWorkspaceResult.IdempotencyConflict))
                    .create(principal, "key", CreateWorkspaceRequest("Platform"))
            }
        assertEquals(409, conflict.status.value())
        assertEquals("IDEMPOTENCY_KEY_REUSED", conflict.code)
    }

    @Test
    fun `list capability and create authorization share server policy while mutation rechecks`() {
        var allowed = false
        val policy =
            WorkspaceCreationPolicy {
                WorkspaceCreationDecision(allowed, if (allowed) null else "CREATION_DISABLED")
            }
        val controller = controller(StubStore(), policy)

        val list = controller.list(principal)
        assertEquals(false, list.capabilities.canCreateWorkspace)
        assertEquals("CREATION_DISABLED", list.capabilities.createWorkspaceReasonCode)
        val denied =
            assertFailsWith<AuthenticationProblemException> {
                controller.create(principal, "key", CreateWorkspaceRequest("Platform"))
            }
        assertEquals(403, denied.status.value())
        assertEquals("WORKSPACE_CREATION_NOT_ALLOWED", denied.code)

        allowed = true
        assertEquals(201, controller.create(principal, "key", CreateWorkspaceRequest("Platform")).statusCode.value())
    }

    @Test
    fun `workspace persistence failures map to stable temporary unavailable problem`() {
        val unavailable = controller(StubStore(unavailable = true))

        val listFailure = assertFailsWith<AuthenticationProblemException> { unavailable.list(principal) }
        assertEquals(503, listFailure.status.value())
        assertEquals("WORKSPACE_TEMPORARILY_UNAVAILABLE", listFailure.code)

        val createFailure =
            assertFailsWith<AuthenticationProblemException> {
                unavailable.create(principal, "key", CreateWorkspaceRequest("Platform"))
            }
        assertEquals(503, createFailure.status.value())
        assertEquals("WORKSPACE_TEMPORARILY_UNAVAILABLE", createFailure.code)
    }

    private fun controller(
        store: WorkspaceStore,
        policy: WorkspaceCreationPolicy = WorkspaceCreationPolicy { WorkspaceCreationDecision(true) },
    ) = WorkspaceController(
        CreateOrganizationWorkspace(store, policy),
        ListAccessibleWorkspaces(store, policy),
    )

    private class StubStore(
        private val items: List<Workspace> = emptyList(),
        private val createResult: CreateWorkspaceResult? = null,
        private val unavailable: Boolean = false,
    ) : WorkspaceStore {
        override fun create(
            actor: UserId,
            idempotencyKey: String,
            workspace: Workspace,
        ): CreateWorkspaceResult {
            if (unavailable) throw WorkspaceStoreUnavailableException()
            return createResult ?: CreateWorkspaceResult.Created(workspace)
        }

        override fun listAccessible(actor: UserId): List<Workspace> {
            if (unavailable) throw WorkspaceStoreUnavailableException()
            return items
        }
    }
}
