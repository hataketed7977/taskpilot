package ai.taskpilot.coreapi.workspace.api

import ai.taskpilot.contract.generated.api.WorkspaceApi
import ai.taskpilot.contract.generated.model.PersonalWorkspaceResponse
import ai.taskpilot.coreapi.currentAuthenticatedActor
import ai.taskpilot.coreapi.workspace.WorkspaceType
import ai.taskpilot.coreapi.workspace.WorkspaceUseCases
import ai.taskpilot.coreapi.workspace.WorkspaceView
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController
import java.time.ZoneOffset

@RestController
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class WorkspaceController(
    private val workspaces: WorkspaceUseCases,
) : WorkspaceApi {
    override fun listWorkspaces(): ResponseEntity<List<PersonalWorkspaceResponse>> {
        val actor = currentAuthenticatedActor()
        return ResponseEntity.ok(workspaces.listFor(actor.userId).map { it.toPersonalResponse() })
    }

    private fun WorkspaceView.toPersonalResponse(): PersonalWorkspaceResponse {
        check(type == WorkspaceType.PERSONAL) { "The current Workspace API only exposes PERSONAL Workspaces" }
        return PersonalWorkspaceResponse(
            workspaceId,
            PersonalWorkspaceResponse.Type.PERSONAL,
            PersonalWorkspaceResponse.Role.OWNER,
            createdAt.atOffset(ZoneOffset.UTC),
            updatedAt.atOffset(ZoneOffset.UTC),
        )
    }
}
