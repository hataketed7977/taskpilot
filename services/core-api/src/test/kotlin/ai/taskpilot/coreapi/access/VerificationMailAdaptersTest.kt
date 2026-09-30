package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.MailDeliveryOutcome
import ai.taskpilot.coreapi.access.application.MailDeliveryResult
import ai.taskpilot.coreapi.access.application.VerificationMailCommand
import ai.taskpilot.coreapi.access.application.VerificationMailTemplate
import ai.taskpilot.coreapi.access.infrastructure.CapturingVerificationMailSender
import ai.taskpilot.coreapi.access.infrastructure.DefiniteMailDeliveryException
import ai.taskpilot.coreapi.access.infrastructure.NanoTimeSource
import ai.taskpilot.coreapi.access.infrastructure.ProductionVerificationMailSender
import ai.taskpilot.coreapi.access.infrastructure.SmtpVerificationMailTransport
import ai.taskpilot.coreapi.access.infrastructure.UnknownMailDeliveryOutcomeException
import ai.taskpilot.coreapi.access.infrastructure.VerificationMailDeliveryEvent
import ai.taskpilot.coreapi.access.infrastructure.VerificationMailDeliveryEventSink
import ai.taskpilot.coreapi.access.infrastructure.VerificationMailTransport
import ai.taskpilot.coreapi.access.model.VerificationCode
import org.springframework.mail.MailAuthenticationException
import org.springframework.mail.MailParseException
import org.springframework.mail.MailSendException
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSenderImpl
import java.time.Duration
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class VerificationMailAdaptersTest {
    @Test
    fun `SMTP transport renders purpose-specific plain text messages`() {
        val cases =
            mapOf(
                VerificationMailTemplate.REGISTRATION_CODE to "TaskPilot registration code",
                VerificationMailTemplate.LOGIN_CODE to "TaskPilot login code",
                VerificationMailTemplate.PASSWORD_RESET_CODE to "TaskPilot password reset code",
            )

        cases.forEach { (template, expectedSubject) ->
            val mailSender = RecordingJavaMailSender()
            val transport = SmtpVerificationMailTransport(mailSender, "no-reply@taskpilot.example")

            assertEquals(
                MailDeliveryOutcome.DELIVERED,
                transport.send(command(template = template)).outcome,
            )

            val message = mailSender.messages.single()
            assertEquals("no-reply@taskpilot.example", message.from)
            assertEquals(listOf("person@example.com"), message.to?.toList())
            assertEquals(expectedSubject, message.subject)
            assertTrue(requireNotNull(message.text).contains("123456"))
            assertTrue(requireNotNull(message.text).contains("2026-09-30T10:10:00Z"))
        }
    }

    @Test
    fun `SMTP transport rejects address header injection before sending`() {
        val mailSender = RecordingJavaMailSender()

        assertFailsWith<IllegalArgumentException> {
            SmtpVerificationMailTransport(mailSender, "no-reply@taskpilot.example\r\nBcc: attacker@example.com")
        }
        assertFailsWith<IllegalArgumentException> {
            SmtpVerificationMailTransport(mailSender, "no-reply@taskpilot.example").send(
                command(recipient = "person@example.com\nBcc: attacker@example.com"),
            )
        }
        assertTrue(mailSender.messages.isEmpty())
    }

    @Test
    fun `SMTP transport classifies definite and unknown provider failures`() {
        val cases =
            listOf(
                MailAuthenticationException("bad credentials person@example.com") to
                    DefiniteMailDeliveryException::class,
                MailParseException("bad message 123456") to DefiniteMailDeliveryException::class,
                MailSendException("connection lost person@example.com 123456") to
                    UnknownMailDeliveryOutcomeException::class,
            )

        cases.forEach { (providerFailure, expectedFailure) ->
            val transport =
                SmtpVerificationMailTransport(
                    FailingJavaMailSender(providerFailure),
                    "no-reply@taskpilot.example",
                )

            val failure = assertFailsWith<RuntimeException> { transport.send(command()) }

            assertTrue(expectedFailure.isInstance(failure))
            assertFalse(requireNotNull(failure.message).contains("person@example.com"))
            assertFalse(requireNotNull(failure.message).contains("123456"))
        }
    }

    @Test
    fun `production adapter records only safe delivery metadata`() {
        val events = RecordingEventSink()
        val time = SequenceNanoTimeSource(100, 1_500_100)
        val sender =
            ProductionVerificationMailSender(
                VerificationMailTransport {
                    MailDeliveryResult(MailDeliveryOutcome.DELIVERED, "provider\nunsafe@example.com")
                },
                events,
                time,
            )

        val result = sender.send(command())

        assertEquals(MailDeliveryOutcome.DELIVERED, result.outcome)
        assertEquals(events.single().safeProviderMessageId, result.safeProviderMessageId)
        assertTrue(requireNotNull(events.single().correlationId).startsWith("sha256:"))
        assertTrue(requireNotNull(events.single().safeProviderMessageId).startsWith("sha256:"))
        assertNotEquals("correlation\nunsafe", events.single().correlationId)
        assertNotEquals("provider\nunsafe@example.com", events.single().safeProviderMessageId)
        assertEquals(
            VerificationMailDeliveryEvent(
                correlationId = requireNotNull(events.single().correlationId),
                template = VerificationMailTemplate.REGISTRATION_CODE,
                safeProviderMessageId = events.single().safeProviderMessageId,
                outcome = MailDeliveryOutcome.DELIVERED,
                duration = java.time.Duration.ofNanos(1_500_000),
            ),
            events.single(),
        )
        val logged = events.single().toString()
        assertFalse(logged.contains("correlation\nunsafe"))
        assertFalse(logged.contains("provider\nunsafe@example.com"))
        assertFalse(logged.contains("person@example.com"))
        assertFalse(logged.contains("123456"))
    }

    @Test
    fun `production adapter maps definite timeout and unknown failures without leaking commands`() {
        val cases =
            listOf(
                DefiniteMailDeliveryException("provider rejected recipient person@example.com") to
                    MailDeliveryOutcome.DEFINITE_FAILURE,
                TimeoutException("timed out for person@example.com") to MailDeliveryOutcome.TIMEOUT,
                UnknownMailDeliveryOutcomeException("response lost 123456") to MailDeliveryOutcome.OUTCOME_UNKNOWN,
                IllegalStateException("unexpected person@example.com 123456") to MailDeliveryOutcome.OUTCOME_UNKNOWN,
            )

        cases.forEach { (failure, expected) ->
            val events = RecordingEventSink()
            val sender =
                ProductionVerificationMailSender(
                    VerificationMailTransport { throw failure },
                    events,
                    SequenceNanoTimeSource(1, 2),
                )

            assertEquals(expected, sender.send(command()).outcome)
            assertEquals(expected, events.single().outcome)
            assertFalse(events.single().toString().contains("person@example.com"))
            assertFalse(events.single().toString().contains("123456"))
        }
    }

    @Test
    fun `production adapter enforces its delivery deadline`() {
        val interrupted = CountDownLatch(1)
        val sender =
            ProductionVerificationMailSender(
                transport =
                    VerificationMailTransport {
                        try {
                            CountDownLatch(1).await()
                            MailDeliveryResult(MailDeliveryOutcome.DELIVERED)
                        } catch (failure: InterruptedException) {
                            interrupted.countDown()
                            throw failure
                        }
                    },
                eventSink = RecordingEventSink(),
                deliveryTimeout = Duration.ofMillis(50),
            )

        assertEquals(MailDeliveryOutcome.TIMEOUT, sender.send(command()).outcome)
        assertTrue(interrupted.await(1, TimeUnit.SECONDS))
    }

    @Test
    fun `capture adapter is explicit inspectable and clearable for local tests`() {
        val sender = CapturingVerificationMailSender()

        assertEquals(MailDeliveryOutcome.DELIVERED, sender.send(command()).outcome)
        assertEquals(1, sender.commands.size)
        sender.clear()
        assertEquals(emptyList(), sender.commands)
    }

    private fun command(
        template: VerificationMailTemplate = VerificationMailTemplate.REGISTRATION_CODE,
        recipient: String = "person@example.com",
    ) = VerificationMailCommand(
        template,
        recipient,
        VerificationCode.fromUserInput("123456"),
        Instant.parse("2026-09-30T10:10:00Z"),
        "correlation\nunsafe",
    )
}

private class RecordingJavaMailSender : JavaMailSenderImpl() {
    val messages = mutableListOf<SimpleMailMessage>()

    override fun send(vararg simpleMessages: SimpleMailMessage) {
        messages += simpleMessages.map(::SimpleMailMessage)
    }
}

private class FailingJavaMailSender(
    private val failure: RuntimeException,
) : JavaMailSenderImpl() {
    override fun send(vararg simpleMessages: SimpleMailMessage): Nothing = throw failure
}

private class RecordingEventSink : VerificationMailDeliveryEventSink {
    private val events = mutableListOf<VerificationMailDeliveryEvent>()

    override fun record(event: VerificationMailDeliveryEvent) {
        events += event
    }

    fun single(): VerificationMailDeliveryEvent = events.single()
}

private class SequenceNanoTimeSource(
    vararg values: Long,
) : NanoTimeSource {
    private val iterator = values.iterator()

    override fun read(): Long = iterator.next()
}
