package ai.taskpilot.coreapi.access.infrastructure

import ai.taskpilot.coreapi.access.application.CreateOrganizationWorkspace
import ai.taskpilot.coreapi.access.application.ListAccessibleWorkspaces
import ai.taskpilot.coreapi.access.application.WorkspaceCreationDecision
import ai.taskpilot.coreapi.access.application.WorkspaceCreationPolicy
import ai.taskpilot.coreapi.access.application.WorkspaceStore
import ai.taskpilot.coreapi.access.persistence.JdbcWorkspaceStore
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import javax.sql.DataSource

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class WorkspaceConfiguration {
    @Bean
    fun workspaceStore(dataSource: DataSource): JdbcWorkspaceStore = JdbcWorkspaceStore(dataSource)

    @Bean
    fun workspaceCreationPolicy() = WorkspaceCreationPolicy { WorkspaceCreationDecision(allowed = true) }

    @Bean
    fun createOrganizationWorkspace(
        store: WorkspaceStore,
        policy: WorkspaceCreationPolicy,
    ) = CreateOrganizationWorkspace(store, policy)

    @Bean
    fun listAccessibleWorkspaces(
        store: WorkspaceStore,
        policy: WorkspaceCreationPolicy,
    ) = ListAccessibleWorkspaces(store, policy)
}
