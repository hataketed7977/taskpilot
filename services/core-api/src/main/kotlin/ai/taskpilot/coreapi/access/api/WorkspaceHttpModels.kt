package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.access.application.WorkspaceListResult
import ai.taskpilot.coreapi.access.model.Workspace
import com.fasterxml.jackson.annotation.JsonInclude
import java.util.UUID

data class CreateWorkspaceRequest(
    val name: String,
)

data class WorkspaceResponse(
    val workspaceId: UUID,
    val name: String,
    val type: String,
) {
    companion object {
        fun from(workspace: Workspace) =
            WorkspaceResponse(
                workspaceId = workspace.workspaceId.value,
                name = workspace.name,
                type = workspace.type.name,
            )
    }
}

@JsonInclude(JsonInclude.Include.NON_NULL)
data class WorkspaceCapabilitiesResponse(
    val canCreateWorkspace: Boolean,
    val createWorkspaceReasonCode: String? = null,
)

data class WorkspaceListResponse(
    val items: List<WorkspaceResponse>,
    val capabilities: WorkspaceCapabilitiesResponse,
) {
    companion object {
        fun from(result: WorkspaceListResult) =
            WorkspaceListResponse(
                result.items.map(WorkspaceResponse::from),
                WorkspaceCapabilitiesResponse(
                    result.canCreateWorkspace,
                    result.createWorkspaceReasonCode,
                ),
            )
    }
}
