package ai.taskpilot.coreapi.access.infrastructure

import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.IssuedSession
import ai.taskpilot.coreapi.access.application.SessionFamilyId
import ai.taskpilot.coreapi.access.application.SessionId
import ai.taskpilot.coreapi.access.application.SessionRecoveryCipher
import ai.taskpilot.coreapi.access.model.UserId
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.security.SecureRandom
import java.time.Instant
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class AesGcmSessionRecoveryCipher(
    key: ByteArray,
    private val secureRandom: SecureRandom = SecureRandom(),
) : SessionRecoveryCipher {
    private val key = SecretKeySpec(key.copyOf(), "AES")

    init {
        require(key.size in AES_KEY_LENGTHS)
    }

    override fun encrypt(session: IssuedSession): ByteArray {
        val nonce = ByteArray(NONCE_BYTES).also(secureRandom::nextBytes)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce))
        val encrypted = cipher.doFinal(session.encode())
        return byteArrayOf(FORMAT_VERSION) + nonce + encrypted
    }

    override fun decrypt(ciphertext: ByteArray): IssuedSession {
        require(ciphertext.size > 1 + NONCE_BYTES && ciphertext.first() == FORMAT_VERSION)
        val nonce = ciphertext.copyOfRange(1, 1 + NONCE_BYTES)
        val encrypted = ciphertext.copyOfRange(1 + NONCE_BYTES, ciphertext.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce))
        return decodeSession(cipher.doFinal(encrypted))
    }

    private fun IssuedSession.encode(): ByteArray =
        ByteArrayOutputStream().use { bytes ->
            DataOutputStream(bytes).use { output ->
                output.writeUtf8(sessionId.value.toString())
                output.writeUtf8(familyId.value.toString())
                output.writeUtf8(accessToken)
                output.writeLong(accessTokenExpiresAt.toEpochMilli())
                output.writeUtf8(refreshToken)
                output.writeLong(refreshTokenExpiresAt.toEpochMilli())
                output.writeUtf8(currentUser.userId.value.toString())
                output.writeUtf8(currentUser.displayName)
                output.writeUtf8(currentUser.email)
            }
            bytes.toByteArray()
        }

    private fun decodeSession(encoded: ByteArray): IssuedSession =
        DataInputStream(ByteArrayInputStream(encoded)).use { input ->
            IssuedSession(
                sessionId = SessionId(UUID.fromString(input.readUtf8())),
                familyId = SessionFamilyId(UUID.fromString(input.readUtf8())),
                accessToken = input.readUtf8(),
                accessTokenExpiresAt = Instant.ofEpochMilli(input.readLong()),
                refreshToken = input.readUtf8(),
                refreshTokenExpiresAt = Instant.ofEpochMilli(input.readLong()),
                currentUser =
                    CurrentUserView(
                        UserId(UUID.fromString(input.readUtf8())),
                        input.readUtf8(),
                        input.readUtf8(),
                    ),
            )
        }

    private fun DataOutputStream.writeUtf8(value: String) {
        val encoded = value.toByteArray(Charsets.UTF_8)
        require(encoded.size <= MAX_FIELD_BYTES)
        writeInt(encoded.size)
        write(encoded)
    }

    private fun DataInputStream.readUtf8(): String {
        val size = readInt()
        require(size in 0..MAX_FIELD_BYTES)
        return readNBytes(size).toString(Charsets.UTF_8)
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val NONCE_BYTES = 12
        const val TAG_BITS = 128
        const val MAX_FIELD_BYTES = 4_096
        const val FORMAT_VERSION: Byte = 1
        val AES_KEY_LENGTHS = setOf(16, 24, 32)
    }
}
