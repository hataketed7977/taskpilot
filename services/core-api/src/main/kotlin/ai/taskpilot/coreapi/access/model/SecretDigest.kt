package ai.taskpilot.coreapi.access.model

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
