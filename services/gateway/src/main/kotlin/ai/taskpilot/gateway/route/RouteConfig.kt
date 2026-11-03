package ai.taskpilot.gateway.route

import ai.taskpilot.gateway.config.GatewayProperties
import org.springframework.cloud.gateway.route.RouteLocator
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.io.ClassPathResource
import tools.jackson.databind.ObjectMapper

@Configuration(proxyBeanMethods = false)
class RouteConfig {
    @Bean
    fun routeCatalog(objectMapper: ObjectMapper): RouteCatalog =
        RouteCatalog.load(ClassPathResource("canonical-api/canonical-routes.json"), objectMapper)

    @Bean
    fun canonicalRoutes(
        builder: RouteLocatorBuilder,
        properties: GatewayProperties,
        catalog: RouteCatalog,
    ): RouteLocator {
        val origin = properties.validatedCoreOrigin().toString()
        return builder
            .routes()
            .apply {
                catalog.routes.forEach { route ->
                    route("canonical-${route.operationId}") { predicate ->
                        predicate
                            .method(route.method)
                            .and()
                            .path(route.path)
                            .uri(origin)
                    }
                }
            }.build()
    }
}
