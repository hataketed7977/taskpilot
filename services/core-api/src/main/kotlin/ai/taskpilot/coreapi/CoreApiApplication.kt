package ai.taskpilot.coreapi

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration

@SpringBootApplication(exclude = [UserDetailsServiceAutoConfiguration::class])
class CoreApiApplication

@Suppress("SpreadOperator")
fun main(args: Array<String>) {
    runApplication<CoreApiApplication>(*args)
}
