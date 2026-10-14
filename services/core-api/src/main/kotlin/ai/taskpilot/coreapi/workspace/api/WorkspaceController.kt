package ai.taskpilot.coreapi.workspace.api

import ai.taskpilot.coreapi.access.DesktopActor
import ai.taskpilot.coreapi.workspace.WorkspaceRole
import ai.taskpilot.coreapi.workspace.WorkspaceType
import ai.taskpilot.coreapi.workspace.WorkspaceUseCases
import ai.taskpilot.coreapi.workspace.WorkspaceView
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/desktop/v1/workspaces")
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class WorkspaceController(
    private val workspaces: WorkspaceUseCases,
) {
    @GetMapping
    fun list(
        @AuthenticationPrincipal actor: DesktopActor,
    ): List<PersonalWorkspaceResponse> = workspaces.listFor(actor.userId).map { it.toPersonalResponse() }

    private fun WorkspaceView.toPersonalResponse(): PersonalWorkspaceResponse {
        check(type == WorkspaceType.PERSONAL) { "The current Desktop Workspace API only exposes PERSONAL Workspaces" }
        return PersonalWorkspaceResponse(workspaceId, PersonalWorkspaceType.PERSONAL, role, createdAt, updatedAt)
    }
}

data class PersonalWorkspaceResponse(
    val workspaceId: UUID,
    val type: PersonalWorkspaceType,
    val role: WorkspaceRole,
    val createdAt: Instant,
    val updatedAt: Instant,
)

enum class PersonalWorkspaceType {
    PERSONAL,
}
