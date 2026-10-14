package ai.taskpilot.coreapi.workspace

import java.time.Instant
import java.util.UUID

fun interface PersonalWorkspaceProvisioner {
    fun provisionPersonalWorkspace(request: PersonalWorkspaceProvisioningRequest): UUID
}

data class PersonalWorkspaceProvisioningRequest(
    val workspaceId: UUID,
    val ownerUserId: UUID,
    val now: Instant,
)
