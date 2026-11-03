package ai.taskpilot.gateway.health

import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.reactive.server.WebTestClient
import java.net.ServerSocket
import java.time.Duration

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UpstreamUnavailableIntegrationTest(
    @param:LocalServerPort private val port: Int,
) {
    private val client =
        WebTestClient
            .bindToServer()
            .baseUrl("http://127.0.0.1:$port")
            .responseTimeout(Duration.ofSeconds(3))
            .build()

    @Test
    fun `unavailable Core returns stable transport problem and makes readiness down`() {
        client
            .get()
            .uri("/v1/me")
            .exchange()
            .expectStatus()
            .isEqualTo(503)
            .expectBody()
            .jsonPath("$.code")
            .isEqualTo("GATEWAY_UPSTREAM_UNAVAILABLE")
            .jsonPath("$.correlationId")
            .isNotEmpty

        client
            .get()
            .uri("/actuator/health/liveness")
            .exchange()
            .expectStatus()
            .isOk

        client
            .get()
            .uri("/actuator/health/readiness")
            .exchange()
            .expectStatus()
            .isEqualTo(503)
            .expectBody()
            .jsonPath("$.status")
            .isEqualTo("DOWN")
    }

    companion object {
        private val unavailablePort = ServerSocket(0).use { it.localPort }

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("taskpilot.gateway.core-origin") { "http://127.0.0.1:$unavailablePort" }
            registry.add("taskpilot.gateway.connect-timeout") { "100ms" }
            registry.add("taskpilot.gateway.response-timeout") { "500ms" }
        }
    }
}
