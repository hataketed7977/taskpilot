package ai.taskpilot.coreapi.onboarding

import ai.taskpilot.coreapi.access.AccessAccountProvisioning
import ai.taskpilot.coreapi.access.FederatedAccountProvisioner
import ai.taskpilot.coreapi.project.PersonalProjectProvisioner
import ai.taskpilot.coreapi.workspace.PersonalWorkspaceProvisioner
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class OnboardingConfiguration {
    @Bean
    fun federatedAccountProvisioner(
        accessAccounts: AccessAccountProvisioning,
        workspaces: PersonalWorkspaceProvisioner,
        projects: PersonalProjectProvisioner,
    ): FederatedAccountProvisioner = OnboardingFederatedAccountProvisioner(accessAccounts, workspaces, projects)
}
