package ai.taskpilot.coreapi.access.infrastructure

import ai.taskpilot.coreapi.access.application.MailDeliveryOutcome
import ai.taskpilot.coreapi.access.application.MailDeliveryResult
import ai.taskpilot.coreapi.access.application.VerificationMailCommand
import ai.taskpilot.coreapi.access.application.VerificationMailSender
import ai.taskpilot.coreapi.access.application.VerificationMailTemplate
import org.slf4j.LoggerFactory
import org.springframework.mail.MailAuthenticationException
import org.springframework.mail.MailException
import org.springframework.mail.MailParseException
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSender
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

fun interface VerificationMailTransport {
    fun send(command: VerificationMailCommand): MailDeliveryResult
}

class SmtpVerificationMailTransport(
    private val mailSender: JavaMailSender,
    private val fromAddress: String,
) : VerificationMailTransport {
    init {
        require(fromAddress.isNotBlank()) { "Verification mail sender must not be blank" }
        require(!fromAddress.contains('\r') && !fromAddress.contains('\n')) {
            "Verification mail sender must not contain line breaks"
        }
    }

    override fun send(command: VerificationMailCommand): MailDeliveryResult {
        require(command.recipient.isNotBlank()) { "Verification mail recipient must not be blank" }
        require(!command.recipient.contains('\r') && !command.recipient.contains('\n')) {
            "Verification mail recipient must not contain line breaks"
        }
        val message =
            SimpleMailMessage().apply {
                from = fromAddress
                setTo(command.recipient)
                subject = command.template.subject
                text = command.plainTextBody()
            }
        return try {
            mailSender.send(message)
            MailDeliveryResult(MailDeliveryOutcome.DELIVERED)
        } catch (failure: MailAuthenticationException) {
            throw DefiniteMailDeliveryException("SMTP authentication failed", failure)
        } catch (failure: MailParseException) {
            throw DefiniteMailDeliveryException("SMTP message was rejected before delivery", failure)
        } catch (failure: MailException) {
            throw UnknownMailDeliveryOutcomeException("SMTP delivery outcome is unknown", failure)
        }
    }

    private val VerificationMailTemplate.subject: String
        get() =
            when (this) {
                VerificationMailTemplate.REGISTRATION_CODE -> "TaskPilot registration code"
                VerificationMailTemplate.LOGIN_CODE -> "TaskPilot login code"
                VerificationMailTemplate.PASSWORD_RESET_CODE -> "TaskPilot password reset code"
            }

    private fun VerificationMailCommand.plainTextBody(): String =
        buildString {
            appendLine("Your TaskPilot verification code is:")
            appendLine()
            appendLine(code.value)
            appendLine()
            append("This code expires at ")
            append(expiresAt)
            appendLine(". If you did not request it, you can ignore this email.")
        }
}

class DefiniteMailDeliveryException(
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

class UnknownMailDeliveryOutcomeException(
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

data class VerificationMailDeliveryEvent(
    val correlationId: String,
    val template: VerificationMailTemplate,
    val safeProviderMessageId: String?,
    val outcome: MailDeliveryOutcome,
    val duration: Duration,
)

fun interface VerificationMailDeliveryEventSink {
    fun record(event: VerificationMailDeliveryEvent)
}

class Slf4jVerificationMailDeliveryEventSink : VerificationMailDeliveryEventSink {
    private val logger = LoggerFactory.getLogger(javaClass)

    override fun record(event: VerificationMailDeliveryEvent) {
        logger.info(
            "Verification mail delivery correlation={} template={} providerMessageId={} outcome={} durationMs={}",
            event.correlationId,
            event.template,
            event.safeProviderMessageId,
            event.outcome,
            event.duration.toMillis(),
        )
    }
}

fun interface NanoTimeSource {
    fun read(): Long
}

class ProductionVerificationMailSender(
    private val transport: VerificationMailTransport,
    private val eventSink: VerificationMailDeliveryEventSink,
    private val nanoTimeSource: NanoTimeSource = NanoTimeSource(System::nanoTime),
    private val deliveryTimeout: Duration = Duration.ofSeconds(DEFAULT_DELIVERY_TIMEOUT_SECONDS),
) : VerificationMailSender {
    init {
        require(!deliveryTimeout.isZero && !deliveryTimeout.isNegative)
    }

    override fun send(command: VerificationMailCommand): MailDeliveryResult {
        val startedAt = nanoTimeSource.read()
        val result =
            try {
                sendWithinDeadline(command)
            } catch (_: DefiniteMailDeliveryException) {
                MailDeliveryResult(MailDeliveryOutcome.DEFINITE_FAILURE)
            } catch (_: TimeoutException) {
                MailDeliveryResult(MailDeliveryOutcome.TIMEOUT)
            } catch (_: UnknownMailDeliveryOutcomeException) {
                MailDeliveryResult(MailDeliveryOutcome.OUTCOME_UNKNOWN)
            } catch (_: RuntimeException) {
                MailDeliveryResult(MailDeliveryOutcome.OUTCOME_UNKNOWN)
            }
        val durationNanos = (nanoTimeSource.read() - startedAt).coerceAtLeast(0)
        val safeResult = result.copy(safeProviderMessageId = result.safeProviderMessageId?.safeLogFingerprint())
        eventSink.record(
            VerificationMailDeliveryEvent(
                correlationId = command.correlationId.safeLogFingerprint(),
                template = command.template,
                safeProviderMessageId = safeResult.safeProviderMessageId,
                outcome = safeResult.outcome,
                duration = Duration.ofNanos(durationNanos),
            ),
        )
        return safeResult
    }

    private fun sendWithinDeadline(command: VerificationMailCommand): MailDeliveryResult {
        val executor = Executors.newVirtualThreadPerTaskExecutor()
        val pending = executor.submit<MailDeliveryResult> { transport.send(command) }
        return try {
            pending.get(deliveryTimeout.toNanos(), TimeUnit.NANOSECONDS)
        } catch (failure: TimeoutException) {
            cancelTimedOutDelivery(pending, failure)
        } catch (failure: InterruptedException) {
            cancelInterruptedDelivery(pending, failure)
        } catch (failure: ExecutionException) {
            throw failure.asMailDeliveryFailure()
        } finally {
            executor.shutdownNow()
        }
    }

    private fun cancelTimedOutDelivery(
        pending: java.util.concurrent.Future<MailDeliveryResult>,
        failure: TimeoutException,
    ): Nothing {
        pending.cancel(true)
        throw failure
    }

    private fun cancelInterruptedDelivery(
        pending: java.util.concurrent.Future<MailDeliveryResult>,
        failure: InterruptedException,
    ): Nothing {
        pending.cancel(true)
        Thread.currentThread().interrupt()
        throw UnknownMailDeliveryOutcomeException("Mail delivery wait was interrupted", failure)
    }

    private fun ExecutionException.asMailDeliveryFailure(): Throwable =
        when (val rootCause = cause) {
            is TimeoutException -> rootCause
            is RuntimeException -> rootCause
            is Error -> rootCause
            else -> UnknownMailDeliveryOutcomeException("Mail transport failed", this)
        }
}

class CapturingVerificationMailSender : VerificationMailSender {
    private val captured = CopyOnWriteArrayList<VerificationMailCommand>()

    val commands: List<VerificationMailCommand>
        get() = captured.toList()

    override fun send(command: VerificationMailCommand): MailDeliveryResult {
        captured += command
        return MailDeliveryResult(MailDeliveryOutcome.DELIVERED, "capture")
    }

    fun clear() {
        captured.clear()
    }
}

private fun String.safeLogFingerprint(): String =
    "sha256:" +
        MessageDigest
            .getInstance("SHA-256")
            .digest(toByteArray(StandardCharsets.UTF_8))
            .take(FINGERPRINT_BYTES)
            .joinToString("") { byte -> "%02x".format(byte) }

private const val FINGERPRINT_BYTES = 12
private const val DEFAULT_DELIVERY_TIMEOUT_SECONDS = 5L
