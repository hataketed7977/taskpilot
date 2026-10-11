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
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals

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
