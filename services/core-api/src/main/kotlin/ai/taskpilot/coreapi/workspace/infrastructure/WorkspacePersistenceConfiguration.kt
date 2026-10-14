package ai.taskpilot.coreapi.workspace.infrastructure

import ai.taskpilot.coreapi.workspace.PersonalWorkspaceProvisioner
import ai.taskpilot.coreapi.workspace.WorkspaceAccessQuery
import ai.taskpilot.coreapi.workspace.WorkspaceUseCases
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import javax.sql.DataSource

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class WorkspacePersistenceConfiguration {
    @Bean
    fun workspaceAccessService(dataSource: DataSource): JdbcWorkspaceAccessService = JdbcWorkspaceAccessService(dataSource)

    @Bean
    fun personalWorkspaceProvisioner(dataSource: DataSource): PersonalWorkspaceProvisioner = JdbcPersonalWorkspaceProvisioner(dataSource)
}
