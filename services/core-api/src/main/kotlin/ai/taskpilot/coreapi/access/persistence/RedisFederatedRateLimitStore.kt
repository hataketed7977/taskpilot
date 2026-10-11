package ai.taskpilot.coreapi.access.persistence

import ai.taskpilot.coreapi.access.application.FederatedAttemptRateLimiter
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.DefaultRedisScript
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.util.HexFormat

class RedisFederatedRateLimitStore(
    private val redis: StringRedisTemplate,
) : FederatedAttemptRateLimiter {
    override fun acquire(
        sourceNetwork: String,
        installationId: String,
        now: Instant,
        window: Duration,
        maximumAttempts: Int,
    ): Long? {
        val result =
            redis.execute(
                ACQUIRE,
                listOf(key("source", sourceNetwork), key("installation", installationId)),
                window.toMillis().toString(),
                maximumAttempts.toString(),
            ) ?: return window.seconds.coerceAtLeast(1)
        return result.takeIf { it > 0 }?.let { (it + MILLIS_PER_SECOND - 1) / MILLIS_PER_SECOND }
    }

    private fun key(
        kind: String,
        value: String,
    ): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8))
        return "taskpilot:auth:rate:$kind:${HexFormat.of().formatHex(digest)}"
    }

    private companion object {
        const val MILLIS_PER_SECOND = 1_000L

        val ACQUIRE =
            DefaultRedisScript(
                """
                local first = redis.call('INCR', KEYS[1])
                if first == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
                local second = redis.call('INCR', KEYS[2])
                if second == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[1]) end
                if first > tonumber(ARGV[2]) or second > tonumber(ARGV[2]) then
                  return math.max(redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2]), 1)
                end
                return 0
                """.trimIndent(),
                Long::class.java,
            )
    }
}
