package ai.taskpilot.coreapi.onboarding

import ai.taskpilot.coreapi.access.AccessAccountProvisioning
import ai.taskpilot.coreapi.access.FederatedAccountProvisioner
import ai.taskpilot.coreapi.access.FederatedAccountProvisioningRequest
import ai.taskpilot.coreapi.access.FederatedAccountProvisioningResult
import ai.taskpilot.coreapi.project.DefaultProjectProvisioningRequest
import ai.taskpilot.coreapi.project.PersonalProjectProvisioner
import ai.taskpilot.coreapi.workspace.PersonalWorkspaceProvisioner
import ai.taskpilot.coreapi.workspace.PersonalWorkspaceProvisioningRequest
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

open class OnboardingFederatedAccountProvisioner(
    private val accessAccounts: AccessAccountProvisioning,
    private val workspaces: PersonalWorkspaceProvisioner,
    private val projects: PersonalProjectProvisioner,
) : FederatedAccountProvisioner {
    @Transactional
    override fun provision(request: FederatedAccountProvisioningRequest): FederatedAccountProvisioningResult {
        val workspaceId = UUID.randomUUID()
        val projectId = UUID.randomUUID()
        accessAccounts.provisionAccount(request)
        workspaces.provisionPersonalWorkspace(
            PersonalWorkspaceProvisioningRequest(workspaceId, request.userId, request.now),
        )
        projects.provisionDefaultProject(
            DefaultProjectProvisioningRequest(
                projectId = projectId,
                workspaceId = workspaceId,
                ownerUserId = request.userId,
                name = defaultProjectName(request.legalLocale),
                now = request.now,
            ),
        )
        return FederatedAccountProvisioningResult(request.userId, workspaceId, projectId)
    }

    private fun defaultProjectName(locale: String) = if (locale == "zh-CN") "我的项目" else "My project"
}
