package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.IssuedSession
import ai.taskpilot.coreapi.access.application.SessionFamilyId
import ai.taskpilot.coreapi.access.application.SessionId
import ai.taskpilot.coreapi.access.infrastructure.AesGcmSessionRecoveryCipher
import ai.taskpilot.coreapi.access.model.UserId
import org.junit.jupiter.api.Test
import java.security.GeneralSecurityException
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class AesGcmSessionRecoveryCipherTest {
    private val cipher = AesGcmSessionRecoveryCipher(ByteArray(32) { it.toByte() })
    private val session =
        IssuedSession(
            sessionId = SessionId(UUID.fromString("10000000-0000-0000-0000-000000000001")),
            familyId = SessionFamilyId(UUID.fromString("20000000-0000-0000-0000-000000000002")),
            accessToken = "access-token-secret",
            accessTokenExpiresAt = Instant.parse("2026-09-30T10:15:00Z"),
            refreshToken = "refresh-token-secret",
            refreshTokenExpiresAt = Instant.parse("2026-10-30T10:00:00Z"),
            currentUser =
                CurrentUserView(
                    UserId(UUID.fromString("30000000-0000-0000-0000-000000000003")),
                    "测试 User",
                    "user@example.com",
                ),
        )

    @Test
    fun `encrypted recovery round trips without plaintext secrets`() {
        val ciphertext = cipher.encrypt(session)

        assertEquals(session, cipher.decrypt(ciphertext))
        val encoded = ciphertext.toString(Charsets.UTF_8)
        assertFalse(encoded.contains(session.accessToken))
        assertFalse(encoded.contains(session.refreshToken))
    }

    @Test
    fun `tampered recovery fails closed`() {
        val ciphertext = cipher.encrypt(session).also { it[it.lastIndex] = (it.last() + 1).toByte() }

        assertFailsWith<GeneralSecurityException> { cipher.decrypt(ciphertext) }
    }

    @Test
    fun `session string redacts all session credentials and internal identifiers`() {
        val rendered = session.toString()

        assertFalse(rendered.contains(session.accessToken))
        assertFalse(rendered.contains(session.refreshToken))
        assertFalse(rendered.contains(session.sessionId.value.toString()))
        assertFalse(rendered.contains(session.familyId.value.toString()))
    }

    @Test
    fun `cipher validates key and envelope before decrypting`() {
        listOf(0, 15, 17, 23, 25, 31, 33).forEach { size ->
            assertFailsWith<IllegalArgumentException> { AesGcmSessionRecoveryCipher(ByteArray(size)) }
        }
        listOf(ByteArray(0), byteArrayOf(1), ByteArray(13), ByteArray(14).also { it[0] = 2 }).forEach { malformed ->
            assertFailsWith<IllegalArgumentException> { cipher.decrypt(malformed) }
        }
    }
}
