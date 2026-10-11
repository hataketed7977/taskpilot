package ai.taskpilot.coreapi.access.persistence

import ai.taskpilot.coreapi.access.application.ACCESS_TOKEN_DIGEST_NAMESPACE
import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.IssuedSession
import ai.taskpilot.coreapi.access.application.REFRESH_TOKEN_DIGEST_NAMESPACE
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.SecretDigester
import ai.taskpilot.coreapi.access.application.SessionFamilyId
import ai.taskpilot.coreapi.access.application.SessionId
import ai.taskpilot.coreapi.access.application.SessionPolicy
import ai.taskpilot.coreapi.access.application.SessionTokenGenerator
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.access.application.SessionUser
import ai.taskpilot.coreapi.access.model.UserId
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.DefaultRedisScript
import java.net.URI
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

class RedisSessionUseCases(
    private val redis: StringRedisTemplate,
    private val digester: SecretDigester,
    private val tokenGenerator: SessionTokenGenerator,
    private val policy: SessionPolicy,
    private val clock: Clock,
) : SessionUseCases {
    override fun issue(user: SessionUser): IssuedSession {
        val now = now()
        return createSession(user, now, now.plus(policy.absoluteTtl))
    }

    override fun refresh(refreshToken: String): RefreshSessionResult {
        val now = now()
        val oldDigest = digestRefresh(refreshToken)
        val newAccessToken = tokenGenerator.generate()
        val newRefreshToken = tokenGenerator.generate()
        val newAccessDigest = digestAccess(newAccessToken)
        val newRefreshDigest = digestRefresh(newRefreshToken)
        val result =
            redis.execute(
                ROTATE_SCRIPT,
                listOf(refreshKey(oldDigest)),
                now.toEpochMilli().toString(),
                newAccessDigest,
                newRefreshDigest,
                policy.accessTtl.toMillis().toString(),
                policy.refreshInactivityTtl.toMillis().toString(),
                PREFIX,
            ) ?: emptyList()
        if (result.firstOrNull() != "OK") return RefreshSessionResult.AuthenticationRequired
        val session =
            runCatching { result.toIssuedSession(newAccessToken, newRefreshToken) }.getOrNull()
                ?: return RefreshSessionResult.AuthenticationRequired
        return RefreshSessionResult.Refreshed(session)
    }

    override fun currentUser(accessToken: String): CurrentUserResult {
        val sessionId =
            redis.opsForValue().get(accessKey(digestAccess(accessToken)))
                ?: return CurrentUserResult.AuthenticationRequired
        val values = redis.opsForHash<String, String>().entries(sessionKey(sessionId))
        val currentUser =
            runCatching {
                val absoluteExpiry = values["absoluteExpiresAt"]?.toLongOrNull() ?: return@runCatching null
                if (absoluteExpiry <= now().toEpochMilli()) return@runCatching null
                values.toCurrentUser()
            }.getOrNull()
        if (currentUser == null) {
            revoke(sessionId)
            return CurrentUserResult.AuthenticationRequired
        }
        return CurrentUserResult.Authenticated(currentUser)
    }

    override fun logout(accessToken: String) {
        redis.opsForValue().get(accessKey(digestAccess(accessToken)))?.let(::revoke)
    }

    private fun createSession(
        user: SessionUser,
        now: Instant,
        absoluteExpiry: Instant,
    ): IssuedSession {
        val sessionId = UUID.randomUUID()
        val familyId = UUID.randomUUID()
        val accessToken = tokenGenerator.generate()
        val refreshToken = tokenGenerator.generate()
        val accessExpiry = minOf(now.plus(policy.accessTtl), absoluteExpiry)
        val refreshExpiry = minOf(now.plus(policy.refreshInactivityTtl), absoluteExpiry)
        val fields =
            mapOf(
                "familyId" to familyId.toString(),
                "userId" to user.userId.value.toString(),
                "displayName" to user.displayName,
                "avatarUrl" to (user.avatarUrl?.toASCIIString() ?: ""),
                "accessDigest" to digestAccess(accessToken),
                "refreshDigest" to digestRefresh(refreshToken),
                "accessExpiresAt" to accessExpiry.toEpochMilli().toString(),
                "refreshExpiresAt" to refreshExpiry.toEpochMilli().toString(),
                "absoluteExpiresAt" to absoluteExpiry.toEpochMilli().toString(),
            )
        val scriptArguments =
            fields.entries.flatMap { listOf(it.key, it.value) }.toTypedArray() +
                arrayOf(now.toEpochMilli().toString(), PREFIX)
        @Suppress("SpreadOperator")
        redis.execute(
            CREATE_SCRIPT,
            listOf(sessionKey(sessionId.toString())),
            *scriptArguments,
        )
        return IssuedSession(
            SessionId(sessionId),
            SessionFamilyId(familyId),
            accessToken,
            accessExpiry,
            refreshToken,
            refreshExpiry,
            CurrentUserView(user.userId, user.displayName, user.avatarUrl),
        )
    }

    @Suppress("MagicNumber")
    private fun List<String>.toIssuedSession(
        accessToken: String,
        refreshToken: String,
    ): IssuedSession? {
        if (size != 10) return null
        return IssuedSession(
            SessionId(UUID.fromString(this[1])),
            SessionFamilyId(UUID.fromString(this[2])),
            accessToken,
            Instant.ofEpochMilli(this[7].toLong()),
            refreshToken,
            Instant.ofEpochMilli(this[8].toLong()),
            CurrentUserView(UserId(UUID.fromString(this[3])), this[4], this[5].ifBlank { null }?.let(URI::create)),
        )
    }

    private fun Map<String, String>.toCurrentUser() =
        CurrentUserView(
            UserId(UUID.fromString(getValue("userId"))),
            getValue("displayName"),
            getValue("avatarUrl").ifBlank { null }?.let(URI::create),
        )

    private fun revoke(sessionId: String) {
        redis.execute(REVOKE_SCRIPT, listOf(sessionKey(sessionId)), PREFIX)
    }

    private fun digestAccess(token: String) = digester.digest(ACCESS_TOKEN_DIGEST_NAMESPACE, token).encoded

    private fun digestRefresh(token: String) = digester.digest(REFRESH_TOKEN_DIGEST_NAMESPACE, token).encoded

    private fun now() = clock.instant().truncatedTo(ChronoUnit.MILLIS)

    private fun sessionKey(id: String) = "${PREFIX}session:$id"

    private fun accessKey(digest: String) = "${PREFIX}access:$digest"

    private fun refreshKey(digest: String) = "${PREFIX}refresh:$digest"

    private companion object {
        const val PREFIX = "taskpilot:auth:"

        val CREATE_SCRIPT =
            DefaultRedisScript(
                """
                local key = KEYS[1]
                for i = 1, #ARGV - 2, 2 do redis.call('HSET', key, ARGV[i], ARGV[i + 1]) end
                local nowMs = tonumber(ARGV[#ARGV - 1])
                local prefix = ARGV[#ARGV]
                local sessionId = string.sub(key, string.len(prefix .. 'session:') + 1)
                local absolute = tonumber(redis.call('HGET', key, 'absoluteExpiresAt'))
                local ttl = math.max(1, absolute - nowMs)
                redis.call('PEXPIRE', key, ttl)
                local access = redis.call('HGET', key, 'accessDigest')
                local refresh = redis.call('HGET', key, 'refreshDigest')
                local accessTtl = math.max(1, tonumber(redis.call('HGET', key, 'accessExpiresAt')) - nowMs)
                local refreshTtl = math.max(1, tonumber(redis.call('HGET', key, 'refreshExpiresAt')) - nowMs)
                redis.call('SET', prefix .. 'access:' .. access, sessionId, 'PX', accessTtl)
                redis.call('SET', prefix .. 'refresh:' .. refresh, 'active:' .. sessionId, 'PX', refreshTtl)
                return 1
                """.trimIndent(),
                Long::class.java,
            )

        @Suppress("UNCHECKED_CAST")
        val ROTATE_SCRIPT =
            DefaultRedisScript(
                """
                local marker = redis.call('GET', KEYS[1])
                if not marker then return {'MISSING'} end
                local prefix = ARGV[6]
                if string.sub(marker, 1, 5) == 'used:' then
                  local replayId = string.sub(marker, 6)
                  local replayKey = prefix .. 'session:' .. replayId
                  local a = redis.call('HGET', replayKey, 'accessDigest')
                  local r = redis.call('HGET', replayKey, 'refreshDigest')
                  if a then redis.call('DEL', prefix .. 'access:' .. a) end
                  if r then redis.call('DEL', prefix .. 'refresh:' .. r) end
                  redis.call('DEL', replayKey)
                  return {'REPLAY'}
                end
                if string.sub(marker, 1, 7) ~= 'active:' then return {'MISSING'} end
                local sessionId = string.sub(marker, 8)
                local sessionKey = prefix .. 'session:' .. sessionId
                local absolute = tonumber(redis.call('HGET', sessionKey, 'absoluteExpiresAt') or '0')
                local oldRefresh = redis.call('HGET', sessionKey, 'refreshDigest')
                local now = tonumber(ARGV[1])
                if absolute <= now or oldRefresh ~= string.sub(KEYS[1], string.len(prefix .. 'refresh:') + 1) then
                  return {'MISSING'}
                end
                local oldAccess = redis.call('HGET', sessionKey, 'accessDigest')
                local accessExpiry = math.min(now + tonumber(ARGV[4]), absolute)
                local refreshExpiry = math.min(now + tonumber(ARGV[5]), absolute)
                redis.call('DEL', prefix .. 'access:' .. oldAccess)
                redis.call('HSET', sessionKey, 'accessDigest', ARGV[2], 'refreshDigest', ARGV[3], 'accessExpiresAt', accessExpiry, 'refreshExpiresAt', refreshExpiry)
                redis.call('SET', KEYS[1], 'used:' .. sessionId, 'PX', math.max(1, absolute - now))
                redis.call('SET', prefix .. 'access:' .. ARGV[2], sessionId, 'PX', math.max(1, accessExpiry - now))
                redis.call('SET', prefix .. 'refresh:' .. ARGV[3], 'active:' .. sessionId, 'PX', math.max(1, refreshExpiry - now))
                return {'OK', sessionId, redis.call('HGET', sessionKey, 'familyId'), redis.call('HGET', sessionKey, 'userId'), redis.call('HGET', sessionKey, 'displayName'), redis.call('HGET', sessionKey, 'avatarUrl'), ARGV[2], tostring(accessExpiry), tostring(refreshExpiry), tostring(absolute)}
                """.trimIndent(),
                List::class.java as Class<List<String>>,
            )

        val REVOKE_SCRIPT =
            DefaultRedisScript(
                """
                local key = KEYS[1]
                local prefix = ARGV[1]
                local access = redis.call('HGET', key, 'accessDigest')
                local refresh = redis.call('HGET', key, 'refreshDigest')
                if access then redis.call('DEL', prefix .. 'access:' .. access) end
                if refresh then redis.call('DEL', prefix .. 'refresh:' .. refresh) end
                redis.call('DEL', key)
                return 1
                """.trimIndent(),
                Long::class.java,
            )
    }
}
