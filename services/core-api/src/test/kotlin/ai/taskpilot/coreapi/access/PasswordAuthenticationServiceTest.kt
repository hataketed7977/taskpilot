package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.PasswordAuthenticationResult
import ai.taskpilot.coreapi.access.application.PasswordAuthenticationService
import ai.taskpilot.coreapi.access.application.PasswordCredentialReader
import ai.taskpilot.coreapi.access.application.PasswordCredentialRecord
import ai.taskpilot.coreapi.access.application.PasswordCredentialRehasher
import ai.taskpilot.coreapi.access.application.PasswordHasher
import ai.taskpilot.coreapi.access.model.PasswordDigest
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PasswordAuthenticationServiceTest {
    private val dummy = PasswordDigest.fromEncoded("dummy-digest")

    @Test
    fun `unknown email verifies against dummy digest and returns the same external result`() {
        val hasher = RecordingPasswordHasher(matches = false)
        val service = service(record = null, hasher = hasher)

        val result = service.authenticate("missing@example.com", "submitted secret")

        assertEquals(PasswordAuthenticationResult.INVALID_CREDENTIALS, result)
        assertEquals(dummy, hasher.verifiedDigest)
        assertNull(hasher.hashedPassword)
    }

    @Test
    fun `wrong password does not rehash or reveal whether the credential exists`() {
        val record = PasswordCredentialRecord(UUID.randomUUID(), PasswordDigest.fromEncoded("stored-digest"))
        val hasher = RecordingPasswordHasher(matches = false, needsUpgrade = true)
        val rehashes = mutableListOf<PasswordDigest>()
        val service = service(record, hasher, rehashes)

        val result = service.authenticate("known@example.com", "wrong secret")

        assertEquals(PasswordAuthenticationResult.INVALID_CREDENTIALS, result)
        assertEquals(record.digest, hasher.verifiedDigest)
        assertEquals(emptyList(), rehashes)
    }

    @Test
    fun `successful verification replaces an old digest before reporting authenticated`() {
        val record = PasswordCredentialRecord(UUID.randomUUID(), PasswordDigest.fromEncoded("old-digest"))
        val hasher = RecordingPasswordHasher(matches = true, needsUpgrade = true)
        val rehashes = mutableListOf<PasswordDigest>()
        val service = service(record, hasher, rehashes)

        val result = service.authenticate("known@example.com", "correct secret")

        assertEquals(PasswordAuthenticationResult.AUTHENTICATED, result)
        assertEquals(listOf(hasher.replacement), rehashes)
        assertEquals("correct secret", hasher.hashedPassword)
    }

    private fun service(
        record: PasswordCredentialRecord?,
        hasher: RecordingPasswordHasher,
        rehashes: MutableList<PasswordDigest> = mutableListOf(),
    ) = PasswordAuthenticationService(
        reader = PasswordCredentialReader { record },
        rehasher =
            PasswordCredentialRehasher { _, _, replacement ->
                rehashes += replacement
                true
            },
        passwordHasher = hasher,
        dummyDigest = dummy,
    )

    private class RecordingPasswordHasher(
        private val matches: Boolean,
        private val needsUpgrade: Boolean = false,
    ) : PasswordHasher {
        val replacement = PasswordDigest.fromEncoded("replacement-digest")
        var verifiedDigest: PasswordDigest? = null
        var hashedPassword: String? = null

        override fun hash(password: CharSequence): PasswordDigest {
            hashedPassword = password.toString()
            return replacement
        }

        override fun matches(
            password: CharSequence,
            digest: PasswordDigest,
        ): Boolean {
            verifiedDigest = digest
            return matches
        }

        override fun needsUpgrade(digest: PasswordDigest): Boolean = needsUpgrade
    }
}
