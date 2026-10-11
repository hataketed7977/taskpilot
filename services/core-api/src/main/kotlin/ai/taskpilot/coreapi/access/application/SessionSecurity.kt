package ai.taskpilot.coreapi.access.application

import java.security.SecureRandom
import java.time.Duration
import java.util.Base64

fun interface SessionTokenGenerator {
    fun generate(): String
}

class SecureSessionTokenGenerator(
    private val secureRandom: SecureRandom = SecureRandom(),
) : SessionTokenGenerator {
    override fun generate(): String {
        val bytes = ByteArray(TOKEN_BYTES)
        secureRandom.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private companion object {
        const val TOKEN_BYTES = 32
    }
}

data class SessionPolicy(
    val accessTtl: Duration = Duration.ofMinutes(DEFAULT_ACCESS_MINUTES),
    val refreshInactivityTtl: Duration = Duration.ofDays(DEFAULT_REFRESH_DAYS),
    val absoluteTtl: Duration = Duration.ofDays(DEFAULT_ABSOLUTE_DAYS),
) {
    init {
        require(accessTtl.isPositive())
        require(refreshInactivityTtl.isPositive())
        require(absoluteTtl >= refreshInactivityTtl)
    }

    private companion object {
        const val DEFAULT_ACCESS_MINUTES = 15L
        const val DEFAULT_REFRESH_DAYS = 30L
        const val DEFAULT_ABSOLUTE_DAYS = 90L
    }
}

internal const val ACCESS_TOKEN_DIGEST_NAMESPACE = "session:access"

internal const val REFRESH_TOKEN_DIGEST_NAMESPACE = "session:refresh"
