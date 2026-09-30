package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.Argon2idParameters
import ai.taskpilot.coreapi.access.application.Argon2idPasswordHasher
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class Argon2idPasswordHasherTest {
    private val current = Argon2idParameters(16, 32, 1, 19_456, 2)
    private val hasher = Argon2idPasswordHasher(current)

    @Test
    fun `rejects parameters below the approved resource and digest bounds`() {
        val invalidParameterFactories =
            listOf(
                { current.copy(saltLength = 15) },
                { current.copy(hashLength = 31) },
                { current.copy(parallelism = 0) },
                { current.copy(memoryKiB = 0) },
                { current.copy(iterations = 0) },
            )

        invalidParameterFactories.forEach { parameters ->
            assertFailsWith<IllegalArgumentException> { Argon2idPasswordHasher(parameters()) }
        }
    }

    @Test
    fun `uses Argon2id current parameters and an independent random salt`() {
        val first = hasher.hash("correct horse battery staple")
        val second = hasher.hash("correct horse battery staple")

        assertNotEquals(first.encodedForTest(), second.encodedForTest())
        assertTrue(first.encodedForTest().startsWith("\$argon2id\$v=19\$m=19456,t=2,p=1\$"))
        assertTrue(hasher.matches("correct horse battery staple", first))
        assertFalse(hasher.matches("wrong password", first))
    }

    @Test
    fun `detects a valid digest with weaker parameters for opportunistic rehash`() {
        val oldHasher = Argon2idPasswordHasher(current.copy(memoryKiB = 8_192, iterations = 1))
        val oldDigest = oldHasher.hash("correct horse battery staple")

        assertTrue(hasher.matches("correct horse battery staple", oldDigest))
        assertTrue(hasher.needsUpgrade(oldDigest))
        assertFalse(hasher.needsUpgrade(hasher.hash("correct horse battery staple")))
    }

    @Test
    fun `digest string representation is always redacted`() {
        val digest = hasher.hash("correct horse battery staple")

        assertTrue(digest.toString().contains("[REDACTED]"))
        assertFalse(digest.toString().contains("argon2"))
    }
}

private fun ai.taskpilot.coreapi.access.model.PasswordDigest.encodedForTest(): String {
    val field = javaClass.getDeclaredField("encoded")
    field.trySetAccessible()
    return field.get(this) as String
}
