package ai.taskpilot.coreapi.project

import java.time.Instant
import java.util.UUID

/** Project-owned write contract used only while onboarding a new account. */
fun interface PersonalProjectProvisioner {
    fun provisionDefaultProject(request: DefaultProjectProvisioningRequest): UUID
}

data class DefaultProjectProvisioningRequest(
    val projectId: UUID,
    val workspaceId: UUID,
    val ownerUserId: UUID,
    val name: String,
    val now: Instant,
    val locale: String = "en",
)
