package ai.taskpilot.coreapi

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Import

/** Application composition-root switch for the shared PostgreSQL infrastructure. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
@Import(DataSourceAutoConfiguration::class)
class CoreApiPersistenceConfiguration
