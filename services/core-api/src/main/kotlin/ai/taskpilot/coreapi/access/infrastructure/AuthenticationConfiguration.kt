package ai.taskpilot.coreapi.access.infrastructure

import ai.taskpilot.coreapi.access.application.HmacSha256SecretDigester
import ai.taskpilot.coreapi.access.application.SecretDigester
import ai.taskpilot.coreapi.access.application.SecureSessionTokenGenerator
import ai.taskpilot.coreapi.access.application.SessionPolicy
import ai.taskpilot.coreapi.access.application.SessionTokenGenerator
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.access.persistence.RedisSessionUseCases
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.data.redis.core.StringRedisTemplate
import java.time.Clock
import java.time.Duration
import java.util.Base64

@ConfigurationProperties("taskpilot.authentication")
data class AuthenticationProperties(
    val enabled: Boolean = false,
    val tokenPepperBase64: String = "",
    val legalBundleVersion: String = "",
    val termsVersion: String = "",
    val privacyVersion: String = "",
    val legalLocales: List<String> = emptyList(),
    val accessTtl: Duration = Duration.ofMinutes(DEFAULT_ACCESS_TTL_MINUTES),
    val refreshInactivityTtl: Duration = Duration.ofDays(DEFAULT_REFRESH_INACTIVITY_TTL_DAYS),
    val refreshAbsoluteTtl: Duration = Duration.ofDays(DEFAULT_REFRESH_ABSOLUTE_TTL_DAYS),
)

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AuthenticationProperties::class)
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class AuthenticationConfiguration {
    @Bean("authenticationClock")
    fun authenticationClock(): Clock = Clock.systemUTC()

    @Bean
    fun sessionPolicy(properties: AuthenticationProperties): SessionPolicy =
        SessionPolicy(properties.accessTtl, properties.refreshInactivityTtl, properties.refreshAbsoluteTtl)

    @Bean
    fun sessionTokenGenerator(): SessionTokenGenerator = SecureSessionTokenGenerator()

    @Bean("sessionSecretDigester")
    fun sessionSecretDigester(properties: AuthenticationProperties): SecretDigester =
        HmacSha256SecretDigester(decode(properties.tokenPepperBase64, "token-pepper-base64"))

    @Bean
    fun sessionUseCases(
        redis: StringRedisTemplate,
        @Qualifier("sessionSecretDigester") digester: SecretDigester,
        tokenGenerator: SessionTokenGenerator,
        sessionPolicy: SessionPolicy,
        @Qualifier("authenticationClock") clock: Clock,
    ): SessionUseCases = RedisSessionUseCases(redis, digester, tokenGenerator, sessionPolicy, clock)

    private fun decode(
        value: String,
        name: String,
    ): ByteArray {
        val decoded =
            try {
                Base64.getDecoder().decode(value)
            } catch (failure: IllegalArgumentException) {
                throw IllegalStateException("taskpilot.authentication.$name must be valid Base64", failure)
            }
        check(decoded.size >= REQUIRED_SECRET_BYTES) {
            "taskpilot.authentication.$name must decode to at least $REQUIRED_SECRET_BYTES bytes"
        }
        return decoded
    }
}

private const val DEFAULT_ACCESS_TTL_MINUTES = 15L
private const val DEFAULT_REFRESH_INACTIVITY_TTL_DAYS = 30L
private const val DEFAULT_REFRESH_ABSOLUTE_TTL_DAYS = 90L
private const val REQUIRED_SECRET_BYTES = 32
