package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.EmailAddressNormalizer
import ai.taskpilot.coreapi.access.model.EmailIdentity
import ai.taskpilot.coreapi.access.model.EmailIdentityId
import ai.taskpilot.coreapi.access.model.NewAccessIdentity
import ai.taskpilot.coreapi.access.model.PasswordCredential
import ai.taskpilot.coreapi.access.model.PasswordDigest
import ai.taskpilot.coreapi.access.model.TermsAcceptance
import ai.taskpilot.coreapi.access.model.UserAccount
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.UserStatus
import java.time.Instant
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AccessIdentityTest {
    @Test
    fun `all identity facts must belong to the same user`() {
        val identity = identity()
        val otherUserId = UserId(UUID.randomUUID())

        listOf(
            { identity.copy(emailIdentity = identity.emailIdentity.copy(userId = otherUserId)) },
            { identity.copy(passwordCredential = identity.passwordCredential.copy(userId = otherUserId)) },
            { identity.copy(termsAcceptance = identity.termsAcceptance.copy(userId = otherUserId)) },
        ).forEach { invalidIdentity ->
            assertFailsWith<IllegalArgumentException> { invalidIdentity() }
        }
    }

    @Test
    fun `identity snapshots redact the password digest`() {
        val identity = identity()

        assertTrue("[REDACTED]" in identity.toString())
        assertFalse(RAW_DIGEST in identity.toString())
    }

    private fun identity(): NewAccessIdentity {
        val userId = UserId(UUID.randomUUID())
        val now = Instant.parse("2026-09-30T00:00:00Z")
        return NewAccessIdentity(
            user = UserAccount(userId, "Task Pilot", UserStatus.ACTIVE, now),
            emailIdentity =
                EmailIdentity(
                    EmailIdentityId(UUID.randomUUID()),
                    userId,
                    EmailAddressNormalizer().normalize("person@example.com"),
                    now,
                    now,
                ),
            passwordCredential = PasswordCredential(userId, PasswordDigest.fromEncoded(RAW_DIGEST), now),
            termsAcceptance = TermsAcceptance(userId, "2026-09", now),
        )
    }

    private companion object {
        const val RAW_DIGEST = "\$argon2id\$v=19\$m=19456,t=2,p=1\$c2FsdA\$aGFzaA"
    }
}
