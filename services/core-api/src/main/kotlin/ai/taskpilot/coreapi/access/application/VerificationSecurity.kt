package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.ContinuationSecret
import ai.taskpilot.coreapi.access.model.SecretDigest
import ai.taskpilot.coreapi.access.model.VerificationCode
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.time.Duration
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

interface SecretDigester {
    fun digest(
        namespace: String,
        secret: CharSequence,
    ): SecretDigest
}

class HmacSha256SecretDigester(
    pepper: ByteArray,
) : SecretDigester {
    private val key = pepper.copyOf()

    init {
        require(key.size >= MINIMUM_PEPPER_BYTES)
    }

    override fun digest(
        namespace: String,
        secret: CharSequence,
    ): SecretDigest {
        require(namespace.isNotBlank())
        val payload = "$namespace\u0000$secret".toByteArray(StandardCharsets.UTF_8)
        return SecretDigest.fromEncoded(newHmacSha256(key).doFinal(payload).base64Url())
    }

    private companion object {
        const val MINIMUM_PEPPER_BYTES = 32
    }
}

fun interface VerificationCodeGenerator {
    fun generate(): VerificationCode
}

class SecureVerificationCodeGenerator(
    private val secureRandom: SecureRandom = SecureRandom(),
) : VerificationCodeGenerator {
    override fun generate(): VerificationCode =
        VerificationCode.fromUserInput(secureRandom.nextInt(CODE_SPACE).toString().padStart(CODE_LENGTH, '0'))

    private companion object {
        const val CODE_LENGTH = 6
        const val CODE_SPACE = 1_000_000
    }
}

fun interface ContinuationSecretGenerator {
    fun generate(): ContinuationSecret
}

class SecureContinuationSecretGenerator(
    private val secureRandom: SecureRandom = SecureRandom(),
) : ContinuationSecretGenerator {
    override fun generate(): ContinuationSecret {
        val bytes = ByteArray(SECRET_BYTES)
        secureRandom.nextBytes(bytes)
        return ContinuationSecret.fromMainInput(bytes.base64Url())
    }

    private companion object {
        const val SECRET_BYTES = 32
    }
}

data class VerificationPolicy(
    val challengeTtl: Duration = Duration.ofMinutes(DEFAULT_CHALLENGE_TTL_MINUTES),
    val maximumAttempts: Int = DEFAULT_MAXIMUM_ATTEMPTS,
    val resendCooldown: Duration = Duration.ofSeconds(DEFAULT_RESEND_COOLDOWN_SECONDS),
    val continuationTtl: Duration = Duration.ofMinutes(DEFAULT_CONTINUATION_TTL_MINUTES),
) {
    init {
        require(!challengeTtl.isNegative && !challengeTtl.isZero)
        require(maximumAttempts > 0)
        require(!resendCooldown.isNegative && !resendCooldown.isZero)
        require(!continuationTtl.isNegative && !continuationTtl.isZero)
    }

    private companion object {
        const val DEFAULT_CHALLENGE_TTL_MINUTES = 10L
        const val DEFAULT_MAXIMUM_ATTEMPTS = 5
        const val DEFAULT_RESEND_COOLDOWN_SECONDS = 60L
        const val DEFAULT_CONTINUATION_TTL_MINUTES = 10L
    }
}

internal fun ByteArray.base64Url(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(this)

private fun newHmacSha256(key: ByteArray): Mac =
    Mac.getInstance("HmacSHA256").apply {
        init(SecretKeySpec(key, "HmacSHA256"))
    }
