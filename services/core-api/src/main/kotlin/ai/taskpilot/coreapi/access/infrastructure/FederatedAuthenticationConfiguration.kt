package ai.taskpilot.coreapi.access.infrastructure

import ai.taskpilot.coreapi.access.application.ApprovedLegalDocuments
import ai.taskpilot.coreapi.access.application.FederatedAead
import ai.taskpilot.coreapi.access.application.FederatedAttemptRateLimiter
import ai.taskpilot.coreapi.access.application.FederatedAuthenticationDependencies
import ai.taskpilot.coreapi.access.application.FederatedAuthenticationService
import ai.taskpilot.coreapi.access.application.FederatedIdentityProvider
import ai.taskpilot.coreapi.access.application.FederatedLoginSecurity
import ai.taskpilot.coreapi.access.application.FederatedLoginStore
import ai.taskpilot.coreapi.access.application.FederatedRuntimeDependencies
import ai.taskpilot.coreapi.access.application.FederatedTokenGenerator
import ai.taskpilot.coreapi.access.application.SecureFederatedTokenGenerator
import ai.taskpilot.coreapi.access.persistence.JdbcFederatedIdentityStore
import ai.taskpilot.coreapi.access.persistence.RedisFederatedLoginStore
import ai.taskpilot.coreapi.access.persistence.RedisFederatedRateLimitStore
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Primary
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.time.Clock
import java.util.Base64
import javax.sql.DataSource

@ConfigurationProperties("taskpilot.authentication.github")
data class FederatedAuthenticationProperties(
    val clientId: String = "",
    val clientSecret: String = "",
    val callbackUri: URI? = null,
    val hmacKeyBase64: String = "",
    val aeadKeyBase64: String = "",
) {
    fun capabilityEnabled(): Boolean {
        val hmac = decoded(hmacKeyBase64)
        val aead = decoded(aeadKeyBase64)
        return clientId.isNotBlank() && clientSecret.isNotBlank() && validCallback(callbackUri) &&
            hmac?.size == KEY_BYTES && aead?.size == KEY_BYTES && !hmac.contentEquals(aead)
    }

    fun security(tokenGenerator: FederatedTokenGenerator = SecureFederatedTokenGenerator()): FederatedLoginSecurity {
        check(capabilityEnabled()) { "GitHub federated authentication configuration is incomplete" }
        return FederatedLoginSecurity(requireNotNull(decoded(hmacKeyBase64)), tokenGenerator)
    }

    fun aead(): FederatedAead {
        check(capabilityEnabled()) { "GitHub federated authentication configuration is incomplete" }
        return FederatedAead(requireNotNull(decoded(aeadKeyBase64)))
    }

    fun provider(): FederatedIdentityProvider {
        check(capabilityEnabled()) { "GitHub federated authentication configuration is incomplete" }
        return GitHubIdentityProvider.create(clientId, clientSecret, requireNotNull(callbackUri))
    }

    private fun validCallback(uri: URI?): Boolean =
        uri != null && uri.scheme == "http" && uri.host == "127.0.0.1" &&
            uri.port in CALLBACK_PORT_MIN..CALLBACK_PORT_MAX &&
            uri.path == "/desktop/v1/auth/federated/github/callback" && uri.query == null &&
            uri.fragment == null && uri.userInfo == null

    private fun decoded(value: String): ByteArray? =
        try {
            Base64.getDecoder().decode(value)
        } catch (_: IllegalArgumentException) {
            null
        }

    private companion object {
        const val KEY_BYTES = 32
        const val CALLBACK_PORT_MIN = 1024
        const val CALLBACK_PORT_MAX = 65535
    }
}

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(FederatedAuthenticationProperties::class)
class FederatedAuthenticationConfiguration {
    @Bean("federatedClock")
    @Primary
    fun federatedClock(): Clock = Clock.systemUTC()

    @Bean
    fun federatedTokenGenerator(): FederatedTokenGenerator = SecureFederatedTokenGenerator()
}

@Configuration(proxyBeanMethods = false)
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
    prefix = "taskpilot.authentication",
    name = ["enabled"],
    havingValue = "true",
)
class FederatedAuthenticationRuntimeConfiguration {
    @Bean
    fun federatedLoginStore(redis: StringRedisTemplate) = RedisFederatedLoginStore(redis)

    @Bean
    fun federatedIdentityStore(dataSource: DataSource) = JdbcFederatedIdentityStore(dataSource)

    @Bean
    fun federatedRateLimitStore(redis: StringRedisTemplate) = RedisFederatedRateLimitStore(redis)

    @Bean
    @Suppress("LongParameterList") // Explicit composition-root wiring for security dependencies.
    fun federatedAuthenticationDependencies(
        properties: FederatedAuthenticationProperties,
        authenticationProperties: AuthenticationProperties,
        providers: org.springframework.beans.factory.ObjectProvider<FederatedIdentityProvider>,
        tokenGenerator: FederatedTokenGenerator,
        objectMapper: ObjectMapper,
        @Qualifier("federatedClock") clock: Clock,
    ) = FederatedAuthenticationDependencies(
        properties.capabilityEnabled(),
        { properties.security(tokenGenerator) },
        { properties.aead() },
        { providers.ifAvailable ?: properties.provider() },
        objectMapper,
        FederatedRuntimeDependencies(
            clock,
            ApprovedLegalDocuments(
                authenticationProperties.legalBundleVersion,
                authenticationProperties.termsVersion,
                authenticationProperties.privacyVersion,
                authenticationProperties.legalLocales,
            ),
        ),
    )

    @Bean
    @Suppress("LongParameterList") // Explicit composition-root wiring for authentication dependencies.
    fun federatedAuthenticationService(
        store: FederatedLoginStore,
        identities: ai.taskpilot.coreapi.access.application.FederatedIdentityStore,
        accountProvisioner: ai.taskpilot.coreapi.access.FederatedAccountProvisioner,
        rateLimits: FederatedAttemptRateLimiter,
        sessions: ai.taskpilot.coreapi.access.application.SessionUseCases,
        dependencies: FederatedAuthenticationDependencies,
    ) = FederatedAuthenticationService(store, identities, accountProvisioner, rateLimits, sessions, dependencies)
}
