package ai.taskpilot.gateway

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication

@SpringBootApplication
@ConfigurationPropertiesScan
class GatewayApplication

@Suppress("SpreadOperator")
fun main(args: Array<String>) {
    runApplication<GatewayApplication>(*args)
}
