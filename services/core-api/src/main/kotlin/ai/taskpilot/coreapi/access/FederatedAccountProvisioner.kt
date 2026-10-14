package ai.taskpilot.coreapi.access

import java.net.URI
import java.time.Instant
import java.util.UUID

/** Access-owned port for atomically provisioning a complete federated account. */
interface FederatedAccountProvisioner {
    fun provision(request: FederatedAccountProvisioningRequest): FederatedAccountProvisioningResult
}

data class FederatedAccountProvisioningRequest(
    val userId: UUID,
    val displayName: String,
    val avatarUrl: URI?,
    val provider: String,
    val authority: URI,
    val subject: String,
    val legalBundleVersion: String,
    val termsVersion: String,
    val privacyVersion: String,
    val legalLocale: String,
    val now: Instant,
)

data class FederatedAccountProvisioningResult(
    val userId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
) {
    fun bootstrap() = FederatedAccountBootstrap(workspaceId, projectId)
}

data class FederatedAccountBootstrap(
    val workspaceId: UUID,
    val projectId: UUID,
)
