package ai.taskpilot.coreapi.access.infrastructure

import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Import

@Configuration(proxyBeanMethods = false)
@ConditionalOnExpression(
    "'\${taskpilot.authentication.enabled:false}' == 'true' || " +
        "'\${taskpilot.verification.enabled:false}' == 'true'",
)
@Import(DataSourceAutoConfiguration::class)
class AccessPersistenceConfiguration
