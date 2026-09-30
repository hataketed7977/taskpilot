package ai.taskpilot.coreapi.access.infrastructure

import ai.taskpilot.coreapi.access.application.HmacSha256SecretDigester
import ai.taskpilot.coreapi.access.application.SecretDigester
import ai.taskpilot.coreapi.access.application.SecureContinuationSecretGenerator
import ai.taskpilot.coreapi.access.application.SecureVerificationCodeGenerator
import ai.taskpilot.coreapi.access.application.VerificationChallengeService
import ai.taskpilot.coreapi.access.application.VerificationMailSender
import ai.taskpilot.coreapi.access.application.VerificationPolicy
import ai.taskpilot.coreapi.access.application.VerificationRateLimiter
import ai.taskpilot.coreapi.access.application.VerificationSecurityComponents
import ai.taskpilot.coreapi.access.persistence.JdbcRateLimitStore
import ai.taskpilot.coreapi.access.persistence.JdbcVerificationStore
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.mail.javamail.JavaMailSenderImpl
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.util.Base64
import javax.sql.DataSource

@ConfigurationProperties("taskpilot.verification")
data class VerificationProperties(
    val enabled: Boolean = false,
    val pepperBase64: String = "",
    val requestMaximumAttempts: Int = 5,
    val verifyMaximumAttempts: Int = 10,
    val rateLimitWindow: Duration = Duration.ofMinutes(DEFAULT_RATE_LIMIT_WINDOW_MINUTES),
) {
    init {
        require(requestMaximumAttempts > 0)
        require(verifyMaximumAttempts > 0)
        require(!rateLimitWindow.isZero && !rateLimitWindow.isNegative)
    }

    private companion object {
        const val DEFAULT_RATE_LIMIT_WINDOW_MINUTES = 15L
    }
}

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(VerificationProperties::class)
@ConditionalOnProperty(prefix = "taskpilot.verification", name = ["enabled"], havingValue = "true")
class VerificationConfiguration {
    @Bean
    fun verificationClock(): Clock = Clock.systemUTC()

    @Bean
    fun verificationSecureRandom(): SecureRandom = SecureRandom()

    @Bean("verificationSecretDigester")
    fun verificationSecretDigester(properties: VerificationProperties): SecretDigester {
        val pepper =
            try {
                Base64.getDecoder().decode(properties.pepperBase64)
            } catch (exception: IllegalArgumentException) {
                throw IllegalStateException("taskpilot.verification.pepper-base64 must be valid Base64", exception)
            }
        check(pepper.size >= MINIMUM_PEPPER_BYTES) {
            "taskpilot.verification.pepper-base64 must decode to at least $MINIMUM_PEPPER_BYTES bytes"
        }
        return HmacSha256SecretDigester(pepper)
    }

    @Bean
    fun jdbcVerificationStore(dataSource: DataSource): JdbcVerificationStore = JdbcVerificationStore(dataSource)

    @Bean
    fun jdbcRateLimitStore(dataSource: DataSource): JdbcRateLimitStore = JdbcRateLimitStore(dataSource)

    @Bean
    fun verificationSecurityComponents(
        rateLimitStore: JdbcRateLimitStore,
        @org.springframework.beans.factory.annotation.Qualifier("verificationSecretDigester")
        secretDigester: SecretDigester,
        secureRandom: SecureRandom,
        properties: VerificationProperties,
    ): VerificationSecurityComponents =
        VerificationSecurityComponents(
            requestRateLimiter =
                VerificationRateLimiter(
                    rateLimitStore,
                    secretDigester,
                    properties.requestMaximumAttempts,
                    properties.rateLimitWindow,
                ),
            codeVerificationRateLimiter =
                VerificationRateLimiter(
                    rateLimitStore,
                    secretDigester,
                    properties.verifyMaximumAttempts,
                    properties.rateLimitWindow,
                ),
            codeGenerator = SecureVerificationCodeGenerator(secureRandom),
            continuationSecretGenerator = SecureContinuationSecretGenerator(secureRandom),
            challengeDigester = secretDigester,
            continuationDigester = secretDigester,
            policy = VerificationPolicy(),
        )

    @Bean
    fun verificationChallengeService(
        store: JdbcVerificationStore,
        security: VerificationSecurityComponents,
        mailSender: VerificationMailSender,
        @org.springframework.beans.factory.annotation.Qualifier("verificationClock") clock: Clock,
    ): VerificationChallengeService = VerificationChallengeService(store, security, mailSender, clock)

    private companion object {
        const val MINIMUM_PEPPER_BYTES = 32
    }
}

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "taskpilot.verification", name = ["mail-adapter"], havingValue = "capture")
class CaptureVerificationMailConfiguration {
    @Bean
    fun verificationMailSender(): CapturingVerificationMailSender = CapturingVerificationMailSender()
}

@ConfigurationProperties("taskpilot.verification.smtp")
data class VerificationSmtpProperties(
    val from: String = "",
)

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(VerificationSmtpProperties::class)
@Profile("local & !production")
@ConditionalOnProperty(prefix = "taskpilot.verification", name = ["mail-adapter"], havingValue = "local")
class LocalVerificationMailConfiguration {
    @Bean
    fun verificationMailDeliveryEventSink() = Slf4jVerificationMailDeliveryEventSink()

    @Bean
    fun verificationMailTransport(
        mailSender: JavaMailSender,
        properties: VerificationSmtpProperties,
    ): VerificationMailTransport {
        require(mailSender is JavaMailSenderImpl) {
            "Local SMTP requires the standard JavaMailSenderImpl"
        }
        require(mailSender.host == LOCAL_SMTP_HOST) {
            "Local plaintext SMTP may connect only to $LOCAL_SMTP_HOST"
        }
        return SmtpVerificationMailTransport(mailSender, properties.from)
    }

    @Bean
    fun verificationMailSender(
        transport: VerificationMailTransport,
        eventSink: VerificationMailDeliveryEventSink,
    ): VerificationMailSender = ProductionVerificationMailSender(transport, eventSink)

    private companion object {
        const val LOCAL_SMTP_HOST = "127.0.0.1"
    }
}

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(VerificationSmtpProperties::class)
@ConditionalOnProperty(prefix = "taskpilot.verification", name = ["mail-adapter"], havingValue = "production")
class ProductionVerificationMailConfiguration {
    @Bean
    fun verificationMailDeliveryEventSink() = Slf4jVerificationMailDeliveryEventSink()

    @Bean
    @ConditionalOnMissingBean(VerificationMailTransport::class)
    fun verificationMailTransport(
        mailSender: JavaMailSender,
        properties: VerificationSmtpProperties,
    ): VerificationMailTransport {
        require(mailSender is JavaMailSenderImpl) {
            "Production SMTP requires the standard JavaMailSenderImpl or an explicit VerificationMailTransport"
        }
        val smtpProperties = mailSender.javaMailProperties
        val startTlsRequired = smtpProperties.getProperty("mail.smtp.starttls.required").toBoolean()
        val transportEncrypted =
            (smtpProperties.getProperty("mail.smtp.starttls.enable").toBoolean() && startTlsRequired) ||
                smtpProperties.getProperty("mail.smtp.ssl.enable").toBoolean()
        require(transportEncrypted) {
            "Production SMTP TLS must require STARTTLS or enable implicit SSL"
        }
        require(!mailSender.host.isNullOrBlank()) {
            "Production SMTP host must be explicitly configured"
        }
        return SmtpVerificationMailTransport(mailSender, properties.from)
    }

    @Bean
    fun verificationMailSender(
        transport: VerificationMailTransport,
        eventSink: VerificationMailDeliveryEventSink,
    ): VerificationMailSender = ProductionVerificationMailSender(transport, eventSink)
}
