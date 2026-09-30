package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.CreateOrganizationWorkspace
import ai.taskpilot.coreapi.access.application.CreateWorkspaceCommand
import ai.taskpilot.coreapi.access.application.CreateWorkspaceResult
import ai.taskpilot.coreapi.access.application.WorkspaceCreationDecision
import ai.taskpilot.coreapi.access.application.WorkspaceCreationPolicy
import ai.taskpilot.coreapi.access.application.WorkspaceStore
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.Workspace
import ai.taskpilot.coreapi.access.model.WorkspaceId
import ai.taskpilot.coreapi.access.model.WorkspaceType
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class CreateOrganizationWorkspaceTest {
    @Test
    fun `uses trusted actor fixed organization type and stable generated id`() {
        val actor = UserId(UUID.randomUUID())
        val generated = WorkspaceId(UUID.randomUUID())
        val store = CapturingWorkspaceStore()
        val useCase = CreateOrganizationWorkspace(store, newWorkspaceId = { generated })

        val result =
            assertIs<CreateWorkspaceResult.Created>(
                useCase.execute(CreateWorkspaceCommand(actor, "  Platform  ", "request-1")),
            )

        assertEquals(generated, result.workspace.workspaceId)
        assertEquals(actor, store.actor)
        assertEquals("Platform", result.workspace.name)
        assertEquals(WorkspaceType.ORGANIZATION, result.workspace.type)
    }

    @Test
    fun `creation policy is rechecked for every mutation and denial does not reach persistence`() {
        val actor = UserId(UUID.randomUUID())
        val store = CapturingWorkspaceStore()
        var allowed = false
        var evaluations = 0
        val useCase =
            CreateOrganizationWorkspace(
                store,
                creationPolicy =
                    WorkspaceCreationPolicy {
                        evaluations += 1
                        WorkspaceCreationDecision(allowed, if (allowed) null else "CREATION_DISABLED")
                    },
            )

        assertEquals(
            CreateWorkspaceResult.CreationNotAllowed,
            useCase.execute(CreateWorkspaceCommand(actor, "Platform", "request-1")),
        )
        assertEquals(0, store.createCalls)
        allowed = true
        assertIs<CreateWorkspaceResult.Created>(
            useCase.execute(CreateWorkspaceCommand(actor, "Platform", "request-2")),
        )
        assertEquals(2, evaluations)
        assertEquals(1, store.createCalls)
    }

    private class CapturingWorkspaceStore : WorkspaceStore {
        var actor: UserId? = null
        var createCalls: Int = 0

        override fun create(
            actor: UserId,
            idempotencyKey: String,
            workspace: Workspace,
        ): CreateWorkspaceResult {
            this.actor = actor
            createCalls += 1
            return CreateWorkspaceResult.Created(workspace)
        }

        override fun listAccessible(actor: UserId) = emptyList<Workspace>()
    }
}
