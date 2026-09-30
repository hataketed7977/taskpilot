package ai.taskpilot.coreapi.project.infrastructure

import ai.taskpilot.coreapi.access.WorkspaceMembershipAuthorizer
import ai.taskpilot.coreapi.project.application.ListProjects
import ai.taskpilot.coreapi.project.application.ProjectListStore
import ai.taskpilot.coreapi.project.persistence.JdbcProjectListStore
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import javax.sql.DataSource

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class ProjectConfiguration {
    @Bean fun projectListStore(dataSource: DataSource): ProjectListStore = JdbcProjectListStore(dataSource)

    @Bean fun listProjects(
        authorizer: WorkspaceMembershipAuthorizer,
        store: ProjectListStore,
    ) = ListProjects(authorizer, store)
}
