package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.PasswordDigest
import ai.taskpilot.coreapi.access.model.PasswordPolicyRule
import ai.taskpilot.coreapi.access.model.PasswordPolicyViolationException
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder
import java.nio.charset.StandardCharsets
import java.util.Locale

fun interface BreachedPasswordChecker {
    fun isBreached(password: CharSequence): Boolean
}

class PasswordPolicy(
    private val breachedPasswordChecker: BreachedPasswordChecker = BreachedPasswordChecker { false },
) {
    fun validate(password: CharSequence) {
        val value = password.toString()
        val codePointCount = value.codePointCount(0, value.length)
        when {
            codePointCount < MIN_CODE_POINTS -> reject(PasswordPolicyRule.TOO_SHORT)
            value.toByteArray(StandardCharsets.UTF_8).size > MAX_UTF8_BYTES -> reject(PasswordPolicyRule.TOO_MANY_BYTES)
            codePointCount > MAX_CODE_POINTS -> reject(PasswordPolicyRule.TOO_LONG)
            value.lowercase(Locale.ROOT) in COMMON_PASSWORDS -> reject(PasswordPolicyRule.COMMON_PASSWORD)
            breachedPasswordChecker.isBreached(value) -> reject(PasswordPolicyRule.BREACHED_PASSWORD)
        }
    }

    private fun reject(rule: PasswordPolicyRule): Nothing = throw PasswordPolicyViolationException(rule)

    private companion object {
        const val MIN_CODE_POINTS = 12
        const val MAX_CODE_POINTS = 128
        const val MAX_UTF8_BYTES = 512
        val COMMON_PASSWORDS =
            setOf(
                "password123!",
                "correcthorsebatterystaple",
                "qwerty123456",
            )
    }
}

data class Argon2idParameters(
    val saltLength: Int,
    val hashLength: Int,
    val parallelism: Int,
    val memoryKiB: Int,
    val iterations: Int,
) {
    init {
        require(saltLength >= MIN_SALT_LENGTH_BYTES) {
            "Argon2id salt must be at least $MIN_SALT_LENGTH_BYTES bytes"
        }
        require(hashLength >= MIN_HASH_LENGTH_BYTES) {
            "Argon2id hash must be at least $MIN_HASH_LENGTH_BYTES bytes"
        }
        require(parallelism > 0) { "Argon2id parallelism must be positive" }
        require(memoryKiB > 0) { "Argon2id memory must be positive" }
        require(iterations > 0) { "Argon2id iterations must be positive" }
    }

    private companion object {
        const val MIN_SALT_LENGTH_BYTES = 16
        const val MIN_HASH_LENGTH_BYTES = 32
    }
}

interface PasswordHasher {
    fun hash(password: CharSequence): PasswordDigest

    fun matches(
        password: CharSequence,
        digest: PasswordDigest,
    ): Boolean

    fun needsUpgrade(digest: PasswordDigest): Boolean
}

class Argon2idPasswordHasher(
    parameters: Argon2idParameters,
) : PasswordHasher {
    private val encoder =
        Argon2PasswordEncoder(
            parameters.saltLength,
            parameters.hashLength,
            parameters.parallelism,
            parameters.memoryKiB,
            parameters.iterations,
        )

    override fun hash(password: CharSequence): PasswordDigest =
        PasswordDigest.fromEncoded(requireNotNull(encoder.encode(password)) { "Argon2id encoder returned no digest" })

    override fun matches(
        password: CharSequence,
        digest: PasswordDigest,
    ): Boolean = encoder.matches(password, digest.encoded)

    override fun needsUpgrade(digest: PasswordDigest): Boolean = encoder.upgradeEncoding(digest.encoded)
}
