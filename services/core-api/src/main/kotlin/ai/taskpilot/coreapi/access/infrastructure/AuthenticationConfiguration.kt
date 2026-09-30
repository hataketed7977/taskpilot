package ai.taskpilot.coreapi.access.infrastructure

import ai.taskpilot.coreapi.access.application.Argon2idParameters
import ai.taskpilot.coreapi.access.application.Argon2idPasswordHasher
import ai.taskpilot.coreapi.access.application.AuthenticationFlowService
import ai.taskpilot.coreapi.access.application.AuthenticationUseCases
import ai.taskpilot.coreapi.access.application.EmailAddressNormalizer
import ai.taskpilot.coreapi.access.application.HmacSha256SecretDigester
import ai.taskpilot.coreapi.access.application.PasswordHasher
import ai.taskpilot.coreapi.access.application.PasswordPolicy
import ai.taskpilot.coreapi.access.application.SecretDigester
import ai.taskpilot.coreapi.access.application.SecureSessionTokenGenerator
import ai.taskpilot.coreapi.access.application.SessionPolicy
import ai.taskpilot.coreapi.access.application.SessionRecoveryCipher
import ai.taskpilot.coreapi.access.application.SessionTokenGenerator
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.access.model.PasswordDigest
import ai.taskpilot.coreapi.access.persistence.JdbcAuthenticationFlowService
import ai.taskpilot.coreapi.access.persistence.JdbcAuthenticationUseCases
import ai.taskpilot.coreapi.access.persistence.JdbcSessionUseCases
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.time.Clock
import java.time.Duration
import java.util.Base64
import javax.sql.DataSource

@ConfigurationProperties("taskpilot.authentication")
data class AuthenticationProperties(
    val enabled: Boolean = false,
    val tokenPepperBase64: String = "",
    val recoveryKeyBase64: String = "",
    val termsVersion: String = "",
    val accessTtl: Duration = Duration.ofMinutes(DEFAULT_ACCESS_TTL_MINUTES),
    val refreshInactivityTtl: Duration = Duration.ofDays(DEFAULT_REFRESH_INACTIVITY_TTL_DAYS),
    val refreshAbsoluteTtl: Duration = Duration.ofDays(DEFAULT_REFRESH_ABSOLUTE_TTL_DAYS),
    val recoveryWindow: Duration = Duration.ofMinutes(DEFAULT_RECOVERY_WINDOW_MINUTES),
    val argon2: Argon2Properties = Argon2Properties(),
) {
    data class Argon2Properties(
        val saltLength: Int = 16,
        val hashLength: Int = 32,
        val parallelism: Int = 1,
        val memoryKib: Int = 19_456,
        val iterations: Int = 2,
    )
}

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AuthenticationProperties::class)
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
// Explicit bean factories keep cryptographic wiring auditable.
@Suppress("TooManyFunctions")
class AuthenticationConfiguration {
    @Bean
    fun emailAddressNormalizer() = EmailAddressNormalizer()

    @Bean
    fun passwordPolicy() = PasswordPolicy()

    @Bean
    fun passwordHasher(properties: AuthenticationProperties): PasswordHasher =
        Argon2idPasswordHasher(
            Argon2idParameters(
                properties.argon2.saltLength,
                properties.argon2.hashLength,
                properties.argon2.parallelism,
                properties.argon2.memoryKib,
                properties.argon2.iterations,
            ),
        )

    @Bean
    fun sessionPolicy(properties: AuthenticationProperties): SessionPolicy =
        SessionPolicy(properties.accessTtl, properties.refreshInactivityTtl, properties.refreshAbsoluteTtl)

    @Bean
    fun sessionTokenGenerator(): SessionTokenGenerator = SecureSessionTokenGenerator()

    @Bean("sessionSecretDigester")
    fun sessionSecretDigester(properties: AuthenticationProperties): SecretDigester =
        HmacSha256SecretDigester(decode(properties.tokenPepperBase64, "token-pepper-base64", REQUIRED_SECRET_BYTES))

    @Bean
    fun sessionRecoveryCipher(properties: AuthenticationProperties): SessionRecoveryCipher =
        AesGcmSessionRecoveryCipher(
            decode(
                properties.recoveryKeyBase64,
                "recovery-key-base64",
                REQUIRED_SECRET_BYTES,
                exact = true,
            ),
        )

    @Bean
    @Suppress("LongParameterList") // Composition-root wiring is intentionally explicit.
    fun authenticationUseCases(
        dataSource: DataSource,
        passwordPolicy: PasswordPolicy,
        passwordHasher: PasswordHasher,
        @Qualifier("verificationSecretDigester") verificationDigester: SecretDigester,
        @Qualifier("sessionSecretDigester") sessionDigester: SecretDigester,
        tokenGenerator: SessionTokenGenerator,
        sessionPolicy: SessionPolicy,
        properties: AuthenticationProperties,
        @Qualifier("verificationClock") clock: Clock,
    ): AuthenticationUseCases {
        check(properties.enabled) { "taskpilot.authentication.enabled must be true when authentication API is active" }
        check(properties.termsVersion.isNotBlank()) { "taskpilot.authentication.terms-version must not be blank" }
        val dummy = passwordHasher.hash("taskpilot fixed dummy password input")
        return JdbcAuthenticationUseCases(
            dataSource,
            passwordPolicy,
            passwordHasher,
            dummy,
            verificationDigester,
            sessionDigester,
            tokenGenerator,
            sessionPolicy,
            properties.termsVersion,
            clock,
        )
    }

    @Bean
    @Suppress("LongParameterList") // Composition-root wiring is intentionally explicit.
    fun sessionUseCases(
        dataSource: DataSource,
        @Qualifier("sessionSecretDigester") digester: SecretDigester,
        tokenGenerator: SessionTokenGenerator,
        recoveryCipher: SessionRecoveryCipher,
        sessionPolicy: SessionPolicy,
        properties: AuthenticationProperties,
        @Qualifier("verificationClock") clock: Clock,
    ): SessionUseCases =
        JdbcSessionUseCases(
            dataSource,
            digester,
            tokenGenerator,
            recoveryCipher,
            sessionPolicy,
            properties.recoveryWindow,
            clock,
        )

    @Bean
    fun authenticationFlowService(
        dataSource: DataSource,
        normalizer: EmailAddressNormalizer,
        verification: ai.taskpilot.coreapi.access.application.VerificationChallengeService,
        authentication: AuthenticationUseCases,
    ): AuthenticationFlowService = JdbcAuthenticationFlowService(dataSource, normalizer, verification, authentication)

    private fun decode(
        value: String,
        name: String,
        minimumBytes: Int,
        exact: Boolean = false,
    ): ByteArray {
        val decoded =
            try {
                Base64.getDecoder().decode(value)
            } catch (failure: IllegalArgumentException) {
                throw IllegalStateException("taskpilot.authentication.$name must be valid Base64", failure)
            }
        check(if (exact) decoded.size == minimumBytes else decoded.size >= minimumBytes) {
            "taskpilot.authentication.$name must decode to ${if (exact) "exactly" else "at least"} $minimumBytes bytes"
        }
        return decoded
    }
}

private const val DEFAULT_ACCESS_TTL_MINUTES = 15L
private const val DEFAULT_REFRESH_INACTIVITY_TTL_DAYS = 30L
private const val DEFAULT_REFRESH_ABSOLUTE_TTL_DAYS = 90L
private const val DEFAULT_RECOVERY_WINDOW_MINUTES = 5L
private const val REQUIRED_SECRET_BYTES = 32
