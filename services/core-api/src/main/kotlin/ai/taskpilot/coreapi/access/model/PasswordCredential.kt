package ai.taskpilot.coreapi.access.model

class PasswordDigest internal constructor(
    internal val encoded: String,
) {
    override fun toString(): String = "PasswordDigest([REDACTED])"

    companion object {
        fun fromEncoded(encoded: String): PasswordDigest = PasswordDigest(encoded)
    }
}

enum class PasswordPolicyRule {
    TOO_SHORT,
    TOO_LONG,
    TOO_MANY_BYTES,
    COMMON_PASSWORD,
    BREACHED_PASSWORD,
}

class PasswordPolicyViolationException(
    val rule: PasswordPolicyRule,
) : IllegalArgumentException("Password does not satisfy policy: $rule")
