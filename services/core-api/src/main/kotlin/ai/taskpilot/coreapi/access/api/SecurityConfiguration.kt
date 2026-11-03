package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.access.application.SessionUseCases
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.ObjectProvider
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.MediaType
import org.springframework.security.config.Customizer
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter

@Configuration(proxyBeanMethods = false)
class SecurityConfiguration {
    @Bean
    @Suppress("LongMethod") // One declarative Spring Security chain is easier to audit as a unit.
    fun securityFilterChain(
        http: HttpSecurity,
        sessions: ObjectProvider<SessionUseCases>,
    ): SecurityFilterChain {
        http
            .csrf { it.disable() }
            .cors(Customizer.withDefaults())
            .requestCache { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .formLogin { it.disable() }
            .httpBasic { it.disable() }
            .logout { it.disable() }
            .exceptionHandling {
                it.authenticationEntryPoint { request, response, _ ->
                    val desktopRequest = request.requestURI.startsWith("/v1/")
                    val status =
                        if (desktopRequest) {
                            HttpServletResponse.SC_UNAUTHORIZED
                        } else {
                            HttpServletResponse.SC_FORBIDDEN
                        }
                    val title = if (desktopRequest) "Unauthorized" else "Forbidden"
                    val code = if (desktopRequest) "AUTHENTICATION_REQUIRED" else "ACCESS_DENIED"
                    val problem = if (desktopRequest) "authentication-required" else "access-denied"
                    response.status = status
                    response.contentType = MediaType.APPLICATION_PROBLEM_JSON_VALUE
                    val correlationId = request.getAttribute(CORRELATION_ID_ATTRIBUTE)?.toString().orEmpty()
                    response.writer.write(
                        "{\"type\":\"https://taskpilot.ai/problems/$problem\"," +
                            "\"title\":\"$title\",\"status\":$status," +
                            "\"code\":\"$code\",\"correlationId\":\"$correlationId\"}",
                    )
                }
                it.accessDeniedHandler { request, response, _ ->
                    response.status = HttpServletResponse.SC_FORBIDDEN
                    response.contentType = MediaType.APPLICATION_PROBLEM_JSON_VALUE
                    val correlationId = request.getAttribute(CORRELATION_ID_ATTRIBUTE)?.toString().orEmpty()
                    response.writer.write(
                        "{\"type\":\"https://taskpilot.ai/problems/access-denied\"," +
                            "\"title\":\"Forbidden\",\"status\":403," +
                            "\"code\":\"ACCESS_DENIED\",\"correlationId\":\"$correlationId\"}",
                    )
                }
            }.authorizeHttpRequests {
                it
                    .requestMatchers(
                        "/actuator/health",
                        "/actuator/health/liveness",
                        "/actuator/health/readiness",
                        "/v3/api-docs/**",
                        "/swagger-ui/**",
                        "/swagger-ui.html",
                        "/error",
                        "/v1/authentication-capabilities",
                        "/v1/federated-login-attempts",
                        "/v1/provider-callbacks/github/oauth",
                        "/v1/federated-login-attempts/*:poll",
                        "/v1/federated-login-attempts/*:cancel",
                        "/v1/federated-registrations",
                        "/v1/session:refresh",
                        "/v1/session:logout",
                    ).permitAll()
                it.requestMatchers("/v1/**").authenticated()
                it.anyRequest().denyAll()
            }
        http.addFilterBefore(DesktopRequestGuardFilter(), UsernamePasswordAuthenticationFilter::class.java)
        sessions.ifAvailable {
            http.addFilterBefore(
                DesktopBearerAuthenticationFilter(it),
                UsernamePasswordAuthenticationFilter::class.java,
            )
        }
        return http.build()
    }
}
