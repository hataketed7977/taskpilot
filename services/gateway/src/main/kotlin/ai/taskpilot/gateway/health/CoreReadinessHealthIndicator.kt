package ai.taskpilot.gateway.health

import ai.taskpilot.gateway.config.GatewayProperties
import org.springframework.boot.health.contributor.Health
import org.springframework.boot.health.contributor.ReactiveHealthIndicator
import org.springframework.stereotype.Component
import org.springframework.web.reactive.function.client.WebClient
import reactor.core.publisher.Mono

@Component("coreApi")
class CoreReadinessHealthIndicator(
    properties: GatewayProperties,
) : ReactiveHealthIndicator {
    private val client = WebClient.builder().baseUrl(properties.validatedCoreOrigin().toString()).build()
    private val timeout = properties.upstreamResponseTimeout

    override fun health(): Mono<Health> =
        client
            .get()
            .uri("/actuator/health/readiness")
            .retrieve()
            .toBodilessEntity()
            .timeout(timeout)
            .map { Health.up().build() }
            .onErrorResume { Mono.just(Health.down().build()) }
}
