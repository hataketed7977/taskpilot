package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.HmacSha256SecretDigester
import ai.taskpilot.coreapi.access.application.SecureContinuationSecretGenerator
import ai.taskpilot.coreapi.access.application.SecureVerificationCodeGenerator
import ai.taskpilot.coreapi.access.application.SessionPolicy
import ai.taskpilot.coreapi.access.application.VerificationPolicy
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class VerificationSecurityTest {
    @Test
    fun `default policy freezes code lifetime attempts resend cooldown and continuation lifetime`() {
        val policy = VerificationPolicy()

        assertEquals(Duration.ofMinutes(10), policy.challengeTtl)
        assertEquals(5, policy.maximumAttempts)
        assertEquals(Duration.ofSeconds(60), policy.resendCooldown)
        assertEquals(Duration.ofMinutes(10), policy.continuationTtl)
    }

    @Test
    fun `secure generator always creates six decimal digits`() {
        val generator = SecureVerificationCodeGenerator()

        repeat(100) {
            assertTrue(generator.generate().toString().contains("[REDACTED]"))
            assertTrue(generator.generate().value.let { it.length == 6 && it.all(Char::isDigit) })
        }
    }

    @Test
    fun `continuation generator returns redacted high entropy url-safe material`() {
        val generator = SecureContinuationSecretGenerator()
        val first = generator.generate()
        val second = generator.generate()

        assertNotEquals(first.value, second.value)
        assertTrue(first.value.length >= 43)
        assertTrue(first.value.all { it.isLetterOrDigit() || it == '-' || it == '_' })
        assertFalse(first.toString().contains(first.value))
    }

    @Test
    fun `digest is namespaced keyed and never renders its encoded value`() {
        val first = HmacSha256SecretDigester(ByteArray(32) { 1 })
        val second = HmacSha256SecretDigester(ByteArray(32) { 2 })
        val register = first.digest("otp:REGISTER_EMAIL_VERIFY", "123456")

        assertNotEquals(register.encoded, first.digest("otp:PASSWORD_RESET", "123456").encoded)
        assertNotEquals(register.encoded, first.digest("otp:REGISTER_EMAIL_VERIFY", "654321").encoded)
        assertNotEquals(register.encoded, second.digest("otp:REGISTER_EMAIL_VERIFY", "123456").encoded)
        assertFalse(register.encoded.contains("123456"))
        assertFalse(register.toString().contains(register.encoded))
    }

    @Test
    fun `verification policy rejects non-positive security limits`() {
        listOf(
            { VerificationPolicy(challengeTtl = Duration.ZERO) },
            { VerificationPolicy(challengeTtl = Duration.ofSeconds(-1)) },
            { VerificationPolicy(maximumAttempts = 0) },
            { VerificationPolicy(resendCooldown = Duration.ZERO) },
            { VerificationPolicy(resendCooldown = Duration.ofSeconds(-1)) },
            { VerificationPolicy(continuationTtl = Duration.ZERO) },
            { VerificationPolicy(continuationTtl = Duration.ofSeconds(-1)) },
        ).forEach { invalid -> assertFailsWith<IllegalArgumentException> { invalid() } }
    }

    @Test
    fun `session policy rejects invalid lifetimes`() {
        listOf(
            { SessionPolicy(accessTtl = Duration.ZERO) },
            { SessionPolicy(refreshInactivityTtl = Duration.ZERO) },
            { SessionPolicy(refreshInactivityTtl = Duration.ofDays(2), absoluteTtl = Duration.ofDays(1)) },
        ).forEach { invalid -> assertFailsWith<IllegalArgumentException> { invalid() } }
    }

    @Test
    fun `digester rejects short pepper and blank namespace`() {
        assertFailsWith<IllegalArgumentException> { HmacSha256SecretDigester(ByteArray(31)) }
        val digester = HmacSha256SecretDigester(ByteArray(32))
        assertFailsWith<IllegalArgumentException> { digester.digest(" ", "secret") }
    }
}
