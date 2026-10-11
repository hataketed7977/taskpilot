package ai.taskpilot.coreapi.access.persistence

import ai.taskpilot.coreapi.access.application.FederatedLoginStore
import ai.taskpilot.coreapi.access.model.AttemptId
import ai.taskpilot.coreapi.access.model.ContinuationId
import ai.taskpilot.coreapi.access.model.FederatedAttemptView
import ai.taskpilot.coreapi.access.model.FederatedCallbackClaim
import ai.taskpilot.coreapi.access.model.FederatedLoginAttempt
import ai.taskpilot.coreapi.access.model.FederatedLoginAttemptStatus
import ai.taskpilot.coreapi.access.model.FederatedRegistrationClaim
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.DefaultRedisScript
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID

class RedisFederatedLoginStore(
    private val redis: StringRedisTemplate,
) : FederatedLoginStore {
    override fun createAttempt(attempt: FederatedLoginAttempt) {
        val ttl = positiveTtl(attempt.createdAt, attempt.expiresAt)
        val created =
            redis.execute(
                CREATE_ATTEMPT,
                listOf(attemptKey(attempt.attemptId), stateKey(attempt.oauthStateDigest)),
                attempt.attemptId.value.toString(),
                attempt.provider,
                attempt.installationId,
                attempt.completionUri.toASCIIString(),
                attempt.pollSecretDigest,
                attempt.oauthStateDigest,
                encode(attempt.encryptedPkceVerifier),
                attempt.status.name,
                attempt.createdAt.toEpochMilli().toString(),
                attempt.expiresAt.toEpochMilli().toString(),
                ttl.toMillis().toString(),
            )
        check(created == 1L) { "Federated login attempt state collision" }
    }

    @Suppress("MagicNumber")
    override fun claimCallbackByState(
        oauthStateDigest: String,
        now: Instant,
    ): FederatedCallbackClaim? {
        val values =
            redis.execute(
                CLAIM_CALLBACK,
                listOf(stateKey(oauthStateDigest)),
                PREFIX,
                now.toEpochMilli().toString(),
            ) ?: return null
        if (values.size != 4 || values.first() != "OK") return null
        return FederatedCallbackClaim(
            AttemptId(UUID.fromString(values[1])),
            java.net.URI.create(values[2]),
            decode(values[3]),
        )
    }

    override fun finishCallback(
        attemptId: AttemptId,
        status: FederatedLoginAttemptStatus,
        now: Instant,
    ): Boolean =
        redis.execute(
            FINISH_CALLBACK,
            listOf(attemptKey(attemptId)),
            now.toEpochMilli().toString(),
            status.name,
        ) == 1L

    override fun completeCallback(
        attemptId: AttemptId,
        encryptedIdentityCandidate: ByteArray,
        completionProofDigest: String,
        now: Instant,
    ): Boolean =
        redis.execute(
            COMPLETE_CALLBACK,
            listOf(attemptKey(attemptId)),
            now.toEpochMilli().toString(),
            encode(encryptedIdentityCandidate),
            completionProofDigest,
        ) == 1L

    override fun findAttemptForPoll(
        attemptId: AttemptId,
        pollSecretDigest: String,
        now: Instant,
    ): FederatedAttemptView? =
        readView(
            redis.execute(
                FIND_FOR_POLL,
                listOf(attemptKey(attemptId)),
                now.toEpochMilli().toString(),
                pollSecretDigest,
            ),
        )

    override fun claimIdentity(
        attemptId: AttemptId,
        pollSecretDigest: String,
        completionProofDigest: String,
        now: Instant,
    ): FederatedAttemptView? =
        readView(
            redis.execute(
                CLAIM_IDENTITY,
                listOf(attemptKey(attemptId)),
                now.toEpochMilli().toString(),
                pollSecretDigest,
                completionProofDigest,
            ),
        )

    override fun requireRegistration(
        attemptId: AttemptId,
        continuationId: ContinuationId,
        continuationSecretDigest: String,
        encryptedResult: ByteArray,
        now: Instant,
    ): Boolean =
        redis.execute(
            REQUIRE_REGISTRATION,
            listOf(attemptKey(attemptId), continuationKey(continuationId)),
            continuationId.value.toString(),
            continuationSecretDigest,
            encode(encryptedResult),
            now.plus(REGISTRATION_TTL).toEpochMilli().toString(),
            REGISTRATION_TTL.toMillis().toString(),
        ) == 1L

    @Suppress("MagicNumber")
    override fun claimRegistration(
        continuationId: ContinuationId,
        continuationSecretDigest: String,
        now: Instant,
    ): FederatedRegistrationClaim? {
        val values =
            redis.execute(
                CLAIM_REGISTRATION,
                listOf(continuationKey(continuationId)),
                PREFIX,
                now.toEpochMilli().toString(),
                continuationSecretDigest,
            ) ?: return null
        if (values.size != 3 || values.first() != "OK") return null
        return FederatedRegistrationClaim(AttemptId(UUID.fromString(values[1])), decode(values[2]))
    }

    override fun releaseIdentity(
        attemptId: AttemptId,
        now: Instant,
    ): Boolean =
        redis.execute(
            RELEASE_IDENTITY,
            listOf(attemptKey(attemptId)),
            now.toEpochMilli().toString(),
        ) == 1L

    override fun releaseRegistration(
        attemptId: AttemptId,
        now: Instant,
    ): Boolean =
        redis.execute(
            RELEASE_REGISTRATION,
            listOf(attemptKey(attemptId)),
            PREFIX,
            now.toEpochMilli().toString(),
        ) == 1L

    override fun complete(
        attemptId: AttemptId,
        encryptedResult: ByteArray,
        now: Instant,
    ): Boolean =
        redis.execute(
            COMPLETE_ATTEMPT,
            listOf(attemptKey(attemptId)),
            encode(encryptedResult),
            now.plus(RESULT_TTL).toEpochMilli().toString(),
            RESULT_TTL.toMillis().toString(),
        ) == 1L

    override fun cancel(
        attemptId: AttemptId,
        pollSecretDigest: String,
        now: Instant,
    ): Boolean =
        redis.execute(
            CANCEL_ATTEMPT,
            listOf(attemptKey(attemptId)),
            PREFIX,
            now.toEpochMilli().toString(),
            pollSecretDigest,
        ) == 1L

    @Suppress("MagicNumber")
    private fun readView(values: List<String>?): FederatedAttemptView? {
        if (values == null || values.size != 6 || values.first() != "OK") return null
        return FederatedAttemptView(
            AttemptId(UUID.fromString(values[1])),
            FederatedLoginAttemptStatus.valueOf(values[2]),
            values[3].ifBlank { null }?.let(::decode),
            values[4].ifBlank { null }?.let(::decode),
            Instant.ofEpochMilli(values[5].toLong()),
        )
    }

    private fun attemptKey(id: AttemptId) = "${PREFIX}attempt:${id.value}"

    private fun stateKey(digest: String) = "${PREFIX}state:$digest"

    private fun continuationKey(id: ContinuationId) = "${PREFIX}continuation:${id.value}"

    private fun encode(value: ByteArray) = Base64.getEncoder().encodeToString(value)

    private fun decode(value: String) = Base64.getDecoder().decode(value)

    private fun positiveTtl(
        from: Instant,
        until: Instant,
    ) = Duration.between(from, until).coerceAtLeast(Duration.ofMillis(1))

    private companion object {
        const val PREFIX = "taskpilot:auth:"
        val REGISTRATION_TTL: Duration = Duration.ofMinutes(10)
        val RESULT_TTL: Duration = Duration.ofMinutes(10)

        @Suppress("UNCHECKED_CAST")
        fun listScript(source: String) = DefaultRedisScript(source.trimIndent(), List::class.java as Class<List<String>>)

        val CREATE_ATTEMPT =
            DefaultRedisScript(
                """
                if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
                redis.call('HSET', KEYS[1],
                  'attemptId', ARGV[1], 'provider', ARGV[2], 'installationId', ARGV[3], 'completionUri', ARGV[4],
                  'pollDigest', ARGV[5], 'stateDigest', ARGV[6], 'encryptedPkce', ARGV[7], 'status', ARGV[8],
                  'createdAt', ARGV[9], 'expiresAt', ARGV[10])
                redis.call('PEXPIRE', KEYS[1], ARGV[11])
                redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[11])
                return 1
                """.trimIndent(),
                Long::class.java,
            )
        val CLAIM_CALLBACK =
            listScript(
                """
            local attemptId = redis.call('GET', KEYS[1])
            if not attemptId then return {'MISS'} end
            local key = ARGV[1] .. 'attempt:' .. attemptId
            local status = redis.call('HGET', key, 'status')
            local expiresAt = tonumber(redis.call('HGET', key, 'expiresAt') or '0')
            if status ~= 'PENDING' or expiresAt <= tonumber(ARGV[2]) then redis.call('DEL', KEYS[1]); return {'MISS'} end
            redis.call('HSET', key, 'status', 'CALLBACK_PROCESSING')
            redis.call('DEL', KEYS[1])
            return {'OK', attemptId, redis.call('HGET', key, 'completionUri'), redis.call('HGET', key, 'encryptedPkce')}
            """,
            )
        val FINISH_CALLBACK =
            DefaultRedisScript(
                """
                if redis.call('HGET', KEYS[1], 'status') ~= 'CALLBACK_PROCESSING' then return 0 end
                if tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') <= tonumber(ARGV[1]) then return 0 end
                redis.call('HSET', KEYS[1], 'status', ARGV[2]); return 1
                """.trimIndent(),
                Long::class.java,
            )
        val COMPLETE_CALLBACK =
            DefaultRedisScript(
                """
                if redis.call('HGET', KEYS[1], 'status') ~= 'CALLBACK_PROCESSING' then return 0 end
                if tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') <= tonumber(ARGV[1]) then return 0 end
                redis.call('HSET', KEYS[1], 'encryptedIdentity', ARGV[2], 'completionProofDigest', ARGV[3], 'status', 'COMPLETION_PENDING')
                return 1
                """.trimIndent(),
                Long::class.java,
            )
        val FIND_FOR_POLL =
            listScript(
                """
            if redis.call('HGET', KEYS[1], 'pollDigest') ~= ARGV[2] then return {'MISS'} end
            local expiresAt = tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0')
            local status = redis.call('HGET', KEYS[1], 'status')
            if expiresAt <= tonumber(ARGV[1]) and status ~= 'COMPLETED' and status ~= 'CANCELLED' and status ~= 'DENIED' and status ~= 'FAILED' then
              status = 'EXPIRED'; redis.call('HSET', KEYS[1], 'status', status)
            end
            return {'OK', redis.call('HGET', KEYS[1], 'attemptId'), status,
              redis.call('HGET', KEYS[1], 'encryptedIdentity') or '', redis.call('HGET', KEYS[1], 'encryptedResult') or '', tostring(expiresAt)}
            """,
            )
        val CLAIM_IDENTITY =
            listScript(
                """
            if redis.call('HGET', KEYS[1], 'status') ~= 'COMPLETION_PENDING' then return {'MISS'} end
            if redis.call('HGET', KEYS[1], 'pollDigest') ~= ARGV[2] or redis.call('HGET', KEYS[1], 'completionProofDigest') ~= ARGV[3] then return {'MISS'} end
            local expiresAt = tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0')
            if expiresAt <= tonumber(ARGV[1]) then return {'MISS'} end
            redis.call('HSET', KEYS[1], 'status', 'IDENTITY_PROCESSING')
            return {'OK', redis.call('HGET', KEYS[1], 'attemptId'), 'IDENTITY_PROCESSING', redis.call('HGET', KEYS[1], 'encryptedIdentity') or '', '', tostring(expiresAt)}
            """,
            )
        val REQUIRE_REGISTRATION =
            DefaultRedisScript(
                """
                if redis.call('HGET', KEYS[1], 'status') ~= 'IDENTITY_PROCESSING' or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
                redis.call('HSET', KEYS[1], 'status', 'REGISTRATION_PENDING', 'continuationId', ARGV[1],
                  'continuationSecretDigest', ARGV[2], 'encryptedResult', ARGV[3], 'expiresAt', ARGV[4])
                redis.call('PEXPIRE', KEYS[1], ARGV[5])
                redis.call('SET', KEYS[2], redis.call('HGET', KEYS[1], 'attemptId'), 'PX', ARGV[5])
                return 1
                """.trimIndent(),
                Long::class.java,
            )
        val CLAIM_REGISTRATION =
            listScript(
                """
            local attemptId = redis.call('GET', KEYS[1])
            if not attemptId then return {'MISS'} end
            local key = ARGV[1] .. 'attempt:' .. attemptId
            if redis.call('HGET', key, 'status') ~= 'REGISTRATION_PENDING' or
               redis.call('HGET', key, 'continuationSecretDigest') ~= ARGV[3] or
               tonumber(redis.call('HGET', key, 'expiresAt') or '0') <= tonumber(ARGV[2]) then return {'MISS'} end
            redis.call('HSET', key, 'status', 'REGISTRATION_PROCESSING')
            redis.call('DEL', KEYS[1])
            return {'OK', attemptId, redis.call('HGET', key, 'encryptedIdentity')}
            """,
            )
        val RELEASE_IDENTITY =
            DefaultRedisScript(
                """
                if redis.call('HGET', KEYS[1], 'status') ~= 'IDENTITY_PROCESSING' then return 0 end
                if tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') <= tonumber(ARGV[1]) then return 0 end
                redis.call('HSET', KEYS[1], 'status', 'COMPLETION_PENDING')
                return 1
                """.trimIndent(),
                Long::class.java,
            )
        val RELEASE_REGISTRATION =
            DefaultRedisScript(
                """
                if redis.call('HGET', KEYS[1], 'status') ~= 'REGISTRATION_PROCESSING' then return 0 end
                local expiresAt = tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0')
                local now = tonumber(ARGV[2])
                local continuationId = redis.call('HGET', KEYS[1], 'continuationId')
                if expiresAt <= now or not continuationId then return 0 end
                redis.call('HSET', KEYS[1], 'status', 'REGISTRATION_PENDING')
                redis.call('SET', ARGV[1] .. 'continuation:' .. continuationId,
                    redis.call('HGET', KEYS[1], 'attemptId'), 'PX', math.max(1, expiresAt - now))
                return 1
                """.trimIndent(),
                Long::class.java,
            )
        val COMPLETE_ATTEMPT =
            DefaultRedisScript(
                """
                local status = redis.call('HGET', KEYS[1], 'status')
                if status ~= 'IDENTITY_PROCESSING' and status ~= 'REGISTRATION_PROCESSING' then return 0 end
                redis.call('HSET', KEYS[1], 'status', 'COMPLETED', 'encryptedResult', ARGV[1], 'expiresAt', ARGV[2])
                redis.call('PEXPIRE', KEYS[1], ARGV[3]); return 1
                """.trimIndent(),
                Long::class.java,
            )
        val CANCEL_ATTEMPT =
            DefaultRedisScript(
                """
                if redis.call('HGET', KEYS[1], 'pollDigest') ~= ARGV[3] then return 0 end
                local status = redis.call('HGET', KEYS[1], 'status')
                if status == 'CANCELLED' then return 1 end
                if status == 'COMPLETED' or status == 'DENIED' or status == 'FAILED' or status == 'EXPIRED' then return 0 end
                if tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') <= tonumber(ARGV[2]) then return 0 end
                local state = redis.call('HGET', KEYS[1], 'stateDigest')
                local continuation = redis.call('HGET', KEYS[1], 'continuationId')
                redis.call('HSET', KEYS[1], 'status', 'CANCELLED')
                if state then redis.call('DEL', ARGV[1] .. 'state:' .. state) end
                if continuation then redis.call('DEL', ARGV[1] .. 'continuation:' .. continuation) end
                return 1
                """.trimIndent(),
                Long::class.java,
            )
    }
}
