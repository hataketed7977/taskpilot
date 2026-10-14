package ai.taskpilot.coreapi.project

import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.transaction.PlatformTransactionManager
import java.time.Clock
import javax.sql.DataSource

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class ProjectProvisioningConfiguration {
    @Bean
    fun personalProjectProvisioner(dataSource: DataSource): PersonalProjectProvisioner = JdbcPersonalProjectProvisioner(dataSource)

    @Bean
    fun projectUseCases(
        dataSource: DataSource,
        workspaceAccess: ai.taskpilot.coreapi.workspace.WorkspaceAccessQuery,
        @Qualifier("authenticationClock") clock: Clock,
        transactionManager: PlatformTransactionManager,
    ): ProjectUseCases =
        ai.taskpilot.coreapi.project.internal.ProjectApplicationService(
            dataSource,
            workspaceAccess,
            clock,
            transactionManager,
        )
}
