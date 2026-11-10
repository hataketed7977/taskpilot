package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.HmacSha256SecretDigester
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.SecureSessionTokenGenerator
import ai.taskpilot.coreapi.access.application.SessionPolicy
import ai.taskpilot.coreapi.access.application.SessionUser
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.persistence.RedisSessionUseCases
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.data.redis.connection.RedisStandaloneConfiguration
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory
import org.springframework.data.redis.core.StringRedisTemplate
import org.testcontainers.containers.GenericContainer
import java.net.URI
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SessionUseCasesIntegrationTest {
    private val redis = SessionRedisContainer().withExposedPorts(6379)
    private lateinit var connection: LettuceConnectionFactory
    private lateinit var template: StringRedisTemplate
    private val now = Instant.parse("2026-10-10T10:00:00Z")

    @BeforeAll
    fun startRedis() {
        redis.start()
        connection = LettuceConnectionFactory(RedisStandaloneConfiguration(redis.host, redis.getMappedPort(6379)))
        connection.afterPropertiesSet()
        template = StringRedisTemplate(connection).also { it.afterPropertiesSet() }
    }

    @BeforeEach
    fun clearRedis() {
        connection.connection.serverCommands().flushAll()
    }

    @AfterAll
    fun stopRedis() {
        connection.destroy()
        redis.stop()
    }

    @Test
    fun `issue resolves access token and logout revokes immediately`() {
        val sessions = sessions()
        val issued = sessions.issue(SessionUser(UserId(UUID.randomUUID()), "Ada", URI("https://example.com/avatar")))

        val current = assertIs<CurrentUserResult.Authenticated>(sessions.currentUser(issued.accessToken))
        assertEquals("Ada", current.currentUser.displayName)
        sessions.logout(issued.accessToken)
        assertIs<CurrentUserResult.AuthenticationRequired>(sessions.currentUser(issued.accessToken))
        assertIs<RefreshSessionResult.AuthenticationRequired>(sessions.refresh(issued.refreshToken))
    }

    @Test
    fun `corrupt session data fails closed and revokes the session`() {
        val sessions = sessions()
        val issued = sessions.issue(SessionUser(UserId(UUID.randomUUID()), "Ada", null))
        val accessDigest =
            HmacSha256SecretDigester(ByteArray(32) { 7 })
                .digest("session:access", issued.accessToken)
                .encoded
        val sessionId = template.opsForValue().get("taskpilot:auth:access:$accessDigest")!!
        template.opsForHash<String, String>().delete("taskpilot:auth:session:$sessionId", "absoluteExpiresAt")

        assertIs<CurrentUserResult.AuthenticationRequired>(sessions.currentUser(issued.accessToken))
        assertIs<RefreshSessionResult.AuthenticationRequired>(sessions.refresh(issued.refreshToken))
    }

    @Test
    fun `refresh rotates both tokens and replay revokes the active family`() {
        val sessions = sessions()
        val issued = sessions.issue(SessionUser(UserId(UUID.randomUUID()), "Ada", null))
        val refreshed = assertIs<RefreshSessionResult.Refreshed>(sessions.refresh(issued.refreshToken)).session

        assertNotEquals(issued.accessToken, refreshed.accessToken)
        assertNotEquals(issued.refreshToken, refreshed.refreshToken)
        assertIs<CurrentUserResult.AuthenticationRequired>(sessions.currentUser(issued.accessToken))
        assertIs<CurrentUserResult.Authenticated>(sessions.currentUser(refreshed.accessToken))

        assertIs<RefreshSessionResult.AuthenticationRequired>(sessions.refresh(issued.refreshToken))
        assertIs<CurrentUserResult.AuthenticationRequired>(sessions.currentUser(refreshed.accessToken))
        assertIs<RefreshSessionResult.AuthenticationRequired>(sessions.refresh(refreshed.refreshToken))
    }

    @Test
    fun `logout must revoke a session after its access index expires`() {
        val sessions = sessions()
        val issued = sessions.issue(SessionUser(UserId(UUID.randomUUID()), "Ada", null))
        val digest = HmacSha256SecretDigester(ByteArray(32) { 7 }).digest("session:access", issued.accessToken).encoded
        template.expire("taskpilot:auth:access:$digest", Duration.ZERO)
        assertIs<CurrentUserResult.AuthenticationRequired>(sessions.currentUser(issued.accessToken))
        sessions.logoutByRefreshToken(issued.refreshToken)
        assertIs<RefreshSessionResult.AuthenticationRequired>(sessions.refresh(issued.refreshToken))
    }

    @Test
    fun `refresh logout linearizes before rotation and used markers revoke the latest pair without extending ttl`() {
        val sessions = sessions()
        val user = SessionUser(UserId(UUID.randomUUID()), "Ada", null)
        val revokedFirst = sessions.issue(user)
        sessions.logoutByRefreshToken(revokedFirst.refreshToken)
        assertIs<RefreshSessionResult.AuthenticationRequired>(sessions.refresh(revokedFirst.refreshToken))

        val original = sessions.issue(user)
        val unrelated = sessions.issue(user)
        val first = assertIs<RefreshSessionResult.Refreshed>(sessions.refresh(original.refreshToken)).session
        val latest = assertIs<RefreshSessionResult.Refreshed>(sessions.refresh(first.refreshToken)).session
        val oldKey = refreshKey(original.refreshToken)
        val marker = template.opsForValue().get(oldKey)
        val ttl = template.getExpire(oldKey, java.util.concurrent.TimeUnit.MILLISECONDS)
        assertTrue(marker!!.startsWith("used:"))
        sessions.logoutByRefreshToken(original.refreshToken)
        sessions.logoutByRefreshToken(original.refreshToken)
        assertEquals(marker, template.opsForValue().get(oldKey))
        assertTrue(template.getExpire(oldKey, java.util.concurrent.TimeUnit.MILLISECONDS) in 1..ttl)
        assertIs<CurrentUserResult.AuthenticationRequired>(sessions.currentUser(latest.accessToken))
        assertIs<RefreshSessionResult.AuthenticationRequired>(sessions.refresh(latest.refreshToken))
        assertIs<CurrentUserResult.Authenticated>(sessions.currentUser(unrelated.accessToken))
        assertIs<RefreshSessionResult.Refreshed>(sessions.refresh(unrelated.refreshToken))
    }

    @Test
    fun `concurrent rotation and refresh logout leave no usable credential`() {
        val sessions = sessions()
        val issued = sessions.issue(SessionUser(UserId(UUID.randomUUID()), "Ada", null))
        val start = CountDownLatch(1)
        val ready = CountDownLatch(2)
        val rotating =
            CompletableFuture.supplyAsync {
                ready.countDown()
                start.await()
                sessions.refresh(issued.refreshToken)
            }
        val revoking =
            CompletableFuture.runAsync {
                ready.countDown()
                start.await()
                sessions.logoutByRefreshToken(issued.refreshToken)
            }
        ready.await()
        start.countDown()
        revoking.join()
        val result = rotating.join()
        if (result is RefreshSessionResult.Refreshed) {
            assertIs<CurrentUserResult.AuthenticationRequired>(sessions.currentUser(result.session.accessToken))
            assertIs<RefreshSessionResult.AuthenticationRequired>(sessions.refresh(result.session.refreshToken))
        }
        assertIs<CurrentUserResult.AuthenticationRequired>(sessions.currentUser(issued.accessToken))
        assertIs<RefreshSessionResult.AuthenticationRequired>(sessions.refresh(issued.refreshToken))
    }

    @Test
    fun `invalid active marker and expired refresh do not revoke another session`() {
        val sessions = sessions()
        val issued = sessions.issue(SessionUser(UserId(UUID.randomUUID()), "Ada", null))
        val marker = template.opsForValue().get(refreshKey(issued.refreshToken))!!
        template.opsForValue().set(refreshKey("unknown"), marker)
        sessions.logoutByRefreshToken("unknown")
        assertIs<CurrentUserResult.Authenticated>(sessions.currentUser(issued.accessToken))
        template.opsForValue().set(refreshKey("malformed"), "garbage")
        sessions.logoutByRefreshToken("malformed")
        template.expire(refreshKey(issued.refreshToken), Duration.ZERO)
        sessions.logoutByRefreshToken(issued.refreshToken)
        assertIs<CurrentUserResult.Authenticated>(sessions.currentUser(issued.accessToken))
        assertIs<RefreshSessionResult.AuthenticationRequired>(sessions.refresh(issued.refreshToken))
    }

    private fun refreshKey(token: String) =
        "taskpilot:auth:refresh:" +
            HmacSha256SecretDigester(ByteArray(32) { 7 }).digest("session:refresh", token).encoded

    private fun sessions() =
        RedisSessionUseCases(
            template,
            HmacSha256SecretDigester(ByteArray(32) { 7 }),
            SecureSessionTokenGenerator(),
            SessionPolicy(Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofDays(90)),
            Clock.fixed(now, ZoneOffset.UTC),
        )
}

private class SessionRedisContainer : GenericContainer<SessionRedisContainer>("redis:7.4-alpine")
