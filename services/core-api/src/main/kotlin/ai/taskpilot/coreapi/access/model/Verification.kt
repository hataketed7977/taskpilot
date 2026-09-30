package ai.taskpilot.coreapi.access.model

import java.time.Instant
import java.util.UUID

@JvmInline
value class VerificationChallengeId(
    val value: UUID,
)

@JvmInline
value class AuthContinuationId(
    val value: UUID,
)

enum class VerificationPurpose {
    REGISTER_EMAIL_VERIFY,
    LOGIN_EMAIL_OTP,
    PASSWORD_RESET,
}

class VerificationCode internal constructor(
    internal val value: String,
) {
    init {
        require(value.length == CODE_LENGTH && value.all(Char::isDigit))
    }

    override fun toString(): String = "VerificationCode([REDACTED])"

    companion object {
        private const val CODE_LENGTH = 6

        fun fromUserInput(value: String): VerificationCode = VerificationCode(value)
    }
}

class ContinuationSecret internal constructor(
    internal val value: String,
) {
    init {
        require(value.isNotBlank())
    }

    override fun toString(): String = "ContinuationSecret([REDACTED])"

    companion object {
        fun fromMainInput(value: String): ContinuationSecret = ContinuationSecret(value)
    }
}

class SecretDigest private constructor(
    internal val encoded: String,
) {
    override fun toString(): String = "SecretDigest([REDACTED])"

    companion object {
        fun fromEncoded(encoded: String): SecretDigest {
            require(encoded.isNotBlank())
            return SecretDigest(encoded)
        }
    }
}

data class VerificationSubject(
    val normalizedEmail: String,
    val userId: UserId?,
) {
    init {
        require(normalizedEmail.isNotBlank())
    }

    override fun toString(): String = "VerificationSubject([REDACTED])"
}

data class IssuedContinuation(
    val continuationId: AuthContinuationId,
    val purpose: VerificationPurpose,
    val secret: ContinuationSecret,
    val expiresAt: Instant,
) {
    override fun toString(): String =
        "IssuedContinuation(continuationId=$continuationId, purpose=$purpose, secret=[REDACTED], expiresAt=$expiresAt)"
}
