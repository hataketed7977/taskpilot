package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.model.AttemptId
import ai.taskpilot.coreapi.access.model.ContinuationId
import ai.taskpilot.coreapi.access.model.FederatedLoginAttempt
import ai.taskpilot.coreapi.access.model.FederatedLoginAttemptStatus
import ai.taskpilot.coreapi.access.persistence.RedisFederatedLoginStore
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
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FederatedLoginAttemptIntegrationTest {
    private val redis = FederatedRedisContainer().withExposedPorts(6379)
    private lateinit var connection: LettuceConnectionFactory
    private lateinit var template: StringRedisTemplate
    private lateinit var store: RedisFederatedLoginStore
    private val now = Instant.parse("2026-10-10T10:00:00Z")

    @BeforeAll
    fun startRedis() {
        redis.start()
        connection = LettuceConnectionFactory(RedisStandaloneConfiguration(redis.host, redis.getMappedPort(6379)))
        connection.afterPropertiesSet()
        template = StringRedisTemplate(connection).also { it.afterPropertiesSet() }
        store = RedisFederatedLoginStore(template)
    }

    @BeforeEach
    fun clearRedis() = connection.connection.serverCommands().flushAll()

    @AfterAll
    fun stopRedis() {
        connection.destroy()
        redis.stop()
    }

    @Test
    fun `state is single use and cancel wins before callback`() {
        val attempt = attempt()
        store.createAttempt(attempt)
        assertTrue(store.cancel(attempt.attemptId, "poll", now.plusSeconds(1)))
        assertNull(store.claimCallbackByState("state", now.plusSeconds(2)))
        assertEquals(
            FederatedLoginAttemptStatus.CANCELLED,
            store.findAttemptForPoll(attempt.attemptId, "poll", now.plusSeconds(2))?.status,
        )
    }

    @Test
    fun `callback proof and registration continuation are each claimed once`() {
        val attempt = attempt()
        store.createAttempt(attempt)
        val callback = assertNotNull(store.claimCallbackByState("state", now.plusSeconds(1)))
        assertNull(store.claimCallbackByState("state", now.plusSeconds(1)))
        assertTrue(store.completeCallback(callback.attemptId, byteArrayOf(4, 2), "proof", now.plusSeconds(2)))
        assertNull(store.claimIdentity(attempt.attemptId, "poll", "wrong", now.plusSeconds(3)))
        val identity = assertNotNull(store.claimIdentity(attempt.attemptId, "poll", "proof", now.plusSeconds(3)))
        assertEquals(FederatedLoginAttemptStatus.IDENTITY_PROCESSING, identity.status)

        val continuation = ContinuationId(UUID.randomUUID())
        assertTrue(
            store.requireRegistration(
                attempt.attemptId,
                continuation,
                "continuation",
                byteArrayOf(9),
                now.plusSeconds(4),
            ),
        )
        assertNotNull(store.claimRegistration(continuation, "continuation", now.plusSeconds(5)))
        assertNull(store.claimRegistration(continuation, "continuation", now.plusSeconds(5)))
        assertTrue(store.releaseRegistration(attempt.attemptId, now.plusSeconds(6)))
        assertNotNull(store.claimRegistration(continuation, "continuation", now.plusSeconds(7)))
    }

    @Test
    fun `failed identity processing can be released and claimed again`() {
        val attempt = attempt()
        store.createAttempt(attempt)
        val callback = assertNotNull(store.claimCallbackByState("state", now.plusSeconds(1)))
        assertTrue(store.completeCallback(callback.attemptId, byteArrayOf(4, 2), "proof", now.plusSeconds(2)))
        assertNotNull(store.claimIdentity(attempt.attemptId, "poll", "proof", now.plusSeconds(3)))

        assertTrue(store.releaseIdentity(attempt.attemptId, now.plusSeconds(4)))
        assertNotNull(store.claimIdentity(attempt.attemptId, "poll", "proof", now.plusSeconds(5)))
    }

    private fun attempt(): FederatedLoginAttempt {
        val id = AttemptId(UUID.randomUUID())
        return FederatedLoginAttempt(
            id,
            "github",
            "installation",
            URI("http://127.0.0.1:50000/taskpilot/oauth/complete/abcdefghijklmnopqrstuvwxyzABCDEF"),
            "poll",
            "state",
            byteArrayOf(1, 2, 3),
            FederatedLoginAttemptStatus.PENDING,
            now,
            now.plusSeconds(300),
        )
    }
}

private class FederatedRedisContainer : GenericContainer<FederatedRedisContainer>("redis:7.4-alpine")
