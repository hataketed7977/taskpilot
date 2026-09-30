package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.BreachedPasswordChecker
import ai.taskpilot.coreapi.access.application.PasswordPolicy
import ai.taskpilot.coreapi.access.model.PasswordPolicyRule
import ai.taskpilot.coreapi.access.model.PasswordPolicyViolationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class PasswordPolicyTest {
    @Test
    fun `accepts spaces unicode and password-manager generated values without transforming them`() {
        PasswordPolicy().validate("  correct horse 🐴 battery staple  ")
        PasswordPolicy().validate("🔐".repeat(128))
    }

    @Test
    fun `enforces code point and UTF-8 resource bounds`() {
        assertRule(PasswordPolicyRule.TOO_SHORT, "🔐".repeat(11))
        assertRule(PasswordPolicyRule.TOO_MANY_BYTES, "🔐".repeat(129))
        assertRule(PasswordPolicyRule.TOO_LONG, "a".repeat(129))
    }

    @Test
    fun `rejects approved common password fixture without exposing the submitted secret`() {
        val secret = "Password123!"
        val failure = assertFailsWith<PasswordPolicyViolationException> { PasswordPolicy().validate(secret) }

        assertEquals(PasswordPolicyRule.COMMON_PASSWORD, failure.rule)
        check(secret !in failure.message.orEmpty())
    }

    @Test
    fun `rejects a password reported by the breached-password boundary`() {
        val policy = PasswordPolicy(BreachedPasswordChecker { it == "unique but leaked phrase" })

        val failure =
            assertFailsWith<PasswordPolicyViolationException> {
                policy.validate("unique but leaked phrase")
            }
        assertEquals(PasswordPolicyRule.BREACHED_PASSWORD, failure.rule)
    }

    private fun assertRule(
        expected: PasswordPolicyRule,
        password: String,
    ) {
        val failure = assertFailsWith<PasswordPolicyViolationException> { PasswordPolicy().validate(password) }
        assertEquals(expected, failure.rule)
    }
}
