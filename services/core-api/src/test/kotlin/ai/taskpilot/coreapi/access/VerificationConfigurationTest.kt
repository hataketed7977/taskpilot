package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.MailDeliveryOutcome
import ai.taskpilot.coreapi.access.application.MailDeliveryResult
import ai.taskpilot.coreapi.access.application.VerificationChallengeService
import ai.taskpilot.coreapi.access.infrastructure.CaptureVerificationMailConfiguration
import ai.taskpilot.coreapi.access.infrastructure.CapturingVerificationMailSender
import ai.taskpilot.coreapi.access.infrastructure.LocalVerificationMailConfiguration
import ai.taskpilot.coreapi.access.infrastructure.ProductionVerificationMailConfiguration
import ai.taskpilot.coreapi.access.infrastructure.ProductionVerificationMailSender
import ai.taskpilot.coreapi.access.infrastructure.VerificationConfiguration
import ai.taskpilot.coreapi.access.infrastructure.VerificationMailTransport
import org.springframework.boot.env.YamlPropertySourceLoader
import org.springframework.context.annotation.AnnotationConfigApplicationContext
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.io.ClassPathResource
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.mail.javamail.JavaMailSenderImpl
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VerificationConfigurationTest {
    @Test
    fun `verification is disabled unless explicitly configured`() {
        context().use { application ->
            application.register(
                VerificationConfiguration::class.java,
                CaptureVerificationMailConfiguration::class.java,
                ProductionVerificationMailConfiguration::class.java,
            )
            application.refresh()

            assertNull(application.getBeanProvider(VerificationChallengeService::class.java).ifAvailable)
        }
    }

    @Test
    fun `capture configuration assembles verification with explicit pepper and data source`() {
        context(
            "taskpilot.verification.enabled" to "true",
            "taskpilot.verification.mail-adapter" to "capture",
            "taskpilot.verification.pepper-base64" to PEPPER,
        ).use { application ->
            application.beanFactory.registerSingleton("dataSource", DriverManagerDataSource())
            application.register(
                VerificationConfiguration::class.java,
                CaptureVerificationMailConfiguration::class.java,
                ProductionVerificationMailConfiguration::class.java,
            )
            application.refresh()

            assertNotNull(application.getBean(VerificationChallengeService::class.java))
            assertNotNull(application.getBean(CapturingVerificationMailSender::class.java))
        }
    }

    @Test
    fun `enabled verification fails closed without a valid pepper`() {
        val failure =
            assertFailsWith<RuntimeException> {
                context(
                    "taskpilot.verification.enabled" to "true",
                    "taskpilot.verification.mail-adapter" to "capture",
                ).use { application ->
                    application.beanFactory.registerSingleton("dataSource", DriverManagerDataSource())
                    application.register(
                        VerificationConfiguration::class.java,
                        CaptureVerificationMailConfiguration::class.java,
                    )
                    application.refresh()
                }
            }

        assertTrue(
            generateSequence(failure as Throwable?) { it.cause }
                .any { it.message?.contains("pepper-base64") == true },
        )
    }

    @Test
    fun `local configuration allows plaintext SMTP only to loopback under local profile`() {
        context(
            "taskpilot.verification.mail-adapter" to "local",
            "taskpilot.verification.smtp.from" to "no-reply@taskpilot.local",
            activeProfiles = arrayOf("local"),
        ).use { application ->
            application.beanFactory.registerSingleton(
                "mailSender",
                JavaMailSenderImpl().apply { host = "127.0.0.1" },
            )
            application.register(LocalVerificationMailConfiguration::class.java)
            application.refresh()

            assertNotNull(application.getBean(VerificationMailTransport::class.java))
            assertNotNull(application.getBean(ProductionVerificationMailSender::class.java))
        }
    }

    @Test
    fun `local plaintext SMTP rejects a non-loopback host`() {
        val failure =
            assertFailsWith<RuntimeException> {
                context(
                    "taskpilot.verification.mail-adapter" to "local",
                    "taskpilot.verification.smtp.from" to "no-reply@taskpilot.local",
                    activeProfiles = arrayOf("local"),
                ).use { application ->
                    application.beanFactory.registerSingleton(
                        "mailSender",
                        JavaMailSenderImpl().apply { host = "mailpit" },
                    )
                    application.register(LocalVerificationMailConfiguration::class.java)
                    application.refresh()
                }
            }

        assertTrue(
            generateSequence(failure as Throwable?) { it.cause }
                .any { it.message?.contains("only to 127.0.0.1") == true },
        )
    }

    @Test
    fun `local mail adapter cannot activate outside local profile`() {
        context(
            "taskpilot.verification.mail-adapter" to "local",
            "taskpilot.verification.smtp.from" to "no-reply@taskpilot.local",
        ).use { application ->
            application.beanFactory.registerSingleton(
                "mailSender",
                JavaMailSenderImpl().apply { host = "127.0.0.1" },
            )
            application.register(LocalVerificationMailConfiguration::class.java)
            application.refresh()

            assertNull(application.getBeanProvider(VerificationMailTransport::class.java).ifAvailable)
        }
    }

    @Test
    fun `local mail adapter cannot activate when production profile is also active`() {
        context(
            "taskpilot.verification.mail-adapter" to "local",
            "taskpilot.verification.smtp.from" to "no-reply@taskpilot.local",
            activeProfiles = arrayOf("local", "production"),
        ).use { application ->
            application.beanFactory.registerSingleton(
                "mailSender",
                JavaMailSenderImpl().apply { host = "127.0.0.1" },
            )
            application.register(LocalVerificationMailConfiguration::class.java)
            application.refresh()

            assertNull(application.getBeanProvider(VerificationMailTransport::class.java).ifAvailable)
        }
    }

    @Test
    fun `production configuration assembles an SMTP transport from the standard mail sender`() {
        context(
            "taskpilot.verification.mail-adapter" to "production",
            "taskpilot.verification.smtp.from" to "no-reply@taskpilot.example",
        ).use { application ->
            application.beanFactory.registerSingleton("mailSender", tlsMailSender())
            application.register(ProductionVerificationMailConfiguration::class.java)
            application.refresh()

            assertNotNull(application.getBean(VerificationMailTransport::class.java))
            assertNotNull(application.getBean(ProductionVerificationMailSender::class.java))
        }
    }

    @Test
    fun `local profile wires external SMTP environment into the production adapter`() {
        val environment = StandardEnvironment()
        environment.propertySources.addFirst(
            MapPropertySource(
                "external-smtp",
                mapOf(
                    "TASKPILOT_VERIFICATION_MAIL_ADAPTER" to "production",
                    "TASKPILOT_VERIFICATION_SMTP_HOST" to "smtp.example.com",
                    "TASKPILOT_VERIFICATION_SMTP_PORT" to "587",
                    "TASKPILOT_VERIFICATION_SMTP_USERNAME" to "smtp-user",
                    "TASKPILOT_VERIFICATION_SMTP_PASSWORD" to "smtp-secret",
                    "TASKPILOT_VERIFICATION_SMTP_FROM" to "no-reply@example.com",
                    "TASKPILOT_VERIFICATION_SMTP_AUTH" to "true",
                    "TASKPILOT_VERIFICATION_SMTP_STARTTLS" to "true",
                    "TASKPILOT_VERIFICATION_SMTP_SSL" to "false",
                ),
            ),
        )
        YamlPropertySourceLoader()
            .load("application-local", ClassPathResource("application-local.yml"))
            .forEach(environment.propertySources::addLast)

        assertEquals("production", environment.getProperty("taskpilot.verification.mail-adapter"))
        assertEquals("smtp.example.com", environment.getProperty("spring.mail.host"))
        assertEquals("587", environment.getProperty("spring.mail.port"))
        assertEquals("true", environment.getProperty("spring.mail.properties.mail.smtp.starttls.required"))
        assertEquals("false", environment.getProperty("spring.mail.properties.mail.smtp.ssl.enable"))
        assertEquals("no-reply@example.com", environment.getProperty("taskpilot.verification.smtp.from"))
    }

    @Test
    fun `production SMTP configuration fails closed without transport encryption`() {
        val failure =
            assertFailsWith<RuntimeException> {
                context(
                    "taskpilot.verification.mail-adapter" to "production",
                    "taskpilot.verification.smtp.from" to "no-reply@taskpilot.example",
                ).use { application ->
                    application.beanFactory.registerSingleton("mailSender", JavaMailSenderImpl())
                    application.register(ProductionVerificationMailConfiguration::class.java)
                    application.refresh()
                }
            }

        assertTrue(
            generateSequence(failure as Throwable?) { it.cause }
                .any { it.message?.contains("SMTP TLS") == true },
        )
    }

    @Test
    fun `production SMTP configuration rejects opportunistic STARTTLS`() {
        val failure =
            assertFailsWith<RuntimeException> {
                context(
                    "taskpilot.verification.mail-adapter" to "production",
                    "taskpilot.verification.smtp.from" to "no-reply@taskpilot.example",
                ).use { application ->
                    application.beanFactory.registerSingleton(
                        "mailSender",
                        JavaMailSenderImpl().apply {
                            host = "smtp.taskpilot.example"
                            javaMailProperties["mail.smtp.starttls.enable"] = "true"
                        },
                    )
                    application.register(ProductionVerificationMailConfiguration::class.java)
                    application.refresh()
                }
            }

        assertTrue(
            generateSequence(failure as Throwable?) { it.cause }
                .any { it.message?.contains("SMTP TLS") == true },
        )
    }

    @Test
    fun `production SMTP configuration fails closed without an explicit host`() {
        val failure =
            assertFailsWith<RuntimeException> {
                context(
                    "taskpilot.verification.mail-adapter" to "production",
                    "taskpilot.verification.smtp.from" to "no-reply@taskpilot.example",
                ).use { application ->
                    application.beanFactory.registerSingleton(
                        "mailSender",
                        JavaMailSenderImpl().apply {
                            javaMailProperties["mail.smtp.ssl.enable"] = "true"
                        },
                    )
                    application.register(ProductionVerificationMailConfiguration::class.java)
                    application.refresh()
                }
            }

        assertTrue(
            generateSequence(failure as Throwable?) { it.cause }
                .any { it.message?.contains("SMTP host") == true },
        )
    }

    @Test
    fun `production configuration requires a transport and wraps it`() {
        context("taskpilot.verification.mail-adapter" to "production").use { application ->
            application.beanFactory.registerSingleton(
                "verificationMailTransport",
                VerificationMailTransport { MailDeliveryResult(MailDeliveryOutcome.DELIVERED) },
            )
            application.register(ProductionVerificationMailConfiguration::class.java)
            application.refresh()

            assertNotNull(application.getBean(ProductionVerificationMailSender::class.java))
        }
    }

    private fun context(
        vararg properties: Pair<String, String>,
        activeProfiles: Array<String> = emptyArray(),
    ): AnnotationConfigApplicationContext =
        AnnotationConfigApplicationContext().apply {
            environment.setActiveProfiles(*activeProfiles)
            environment.propertySources.addFirst(MapPropertySource("test", properties.toMap()))
        }

    private fun tlsMailSender(): JavaMailSenderImpl =
        JavaMailSenderImpl().apply {
            host = "smtp.taskpilot.example"
            javaMailProperties["mail.smtp.starttls.enable"] = "true"
            javaMailProperties["mail.smtp.starttls.required"] = "true"
        }

    private companion object {
        val PEPPER: String = Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
    }
}
