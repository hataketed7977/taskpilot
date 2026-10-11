package ai.taskpilot.coreapi.access.application

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

fun interface FederatedTokenGenerator {
    fun generate(byteCount: Int): String
}

class SecureFederatedTokenGenerator(
    private val secureRandom: SecureRandom = SecureRandom(),
) : FederatedTokenGenerator {
    override fun generate(byteCount: Int): String {
        require(byteCount > 0)
        return ByteArray(byteCount).also(secureRandom::nextBytes).base64Url()
    }
}

enum class FederatedSecretPurpose(
    val namespace: String,
) {
    OAUTH_STATE("federated:oauth-state"),
    POLL("federated:poll"),
    COMPLETION("federated:completion"),
    REGISTRATION_CONTINUATION("federated:registration-continuation"),
}

class FederatedLoginSecurity(
    hmacKey: ByteArray,
    private val tokenGenerator: FederatedTokenGenerator = SecureFederatedTokenGenerator(),
) {
    private val key = hmacKey.copyOf()

    init {
        require(key.size >= REQUIRED_KEY_BYTES)
    }

    fun newSecret(): String = tokenGenerator.generate(SECRET_BYTES)

    fun newPkceVerifier(): String = tokenGenerator.generate(PKCE_VERIFIER_BYTES)

    fun pkceS256(verifier: String): String =
        MessageDigest
            .getInstance("SHA-256")
            .digest(verifier.toByteArray(StandardCharsets.US_ASCII))
            .base64Url()

    fun digest(
        purpose: FederatedSecretPurpose,
        secret: CharSequence,
    ): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac
            .doFinal("${purpose.namespace}\u0000$secret".toByteArray(StandardCharsets.UTF_8))
            .base64Url()
    }

    private companion object {
        const val REQUIRED_KEY_BYTES = 32
        const val SECRET_BYTES = 32
        const val PKCE_VERIFIER_BYTES = 64
    }
}

class FederatedAead(
    key: ByteArray,
    private val secureRandom: SecureRandom = SecureRandom(),
) {
    private val key = SecretKeySpec(key.copyOf(), "AES")

    init {
        require(key.size == REQUIRED_KEY_BYTES)
    }

    fun encrypt(
        associatedData: String,
        plaintext: ByteArray,
    ): ByteArray {
        require(associatedData.isNotBlank())
        val nonce = ByteArray(NONCE_BYTES).also(secureRandom::nextBytes)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(associatedData.toByteArray(StandardCharsets.UTF_8))
        return byteArrayOf(FORMAT_VERSION) + nonce + cipher.doFinal(plaintext)
    }

    fun decrypt(
        associatedData: String,
        ciphertext: ByteArray,
    ): ByteArray {
        require(associatedData.isNotBlank())
        require(ciphertext.size > 1 + NONCE_BYTES && ciphertext.first() == FORMAT_VERSION)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(TAG_BITS, ciphertext.copyOfRange(1, 1 + NONCE_BYTES)),
        )
        cipher.updateAAD(associatedData.toByteArray(StandardCharsets.UTF_8))
        return cipher.doFinal(ciphertext.copyOfRange(1 + NONCE_BYTES, ciphertext.size))
    }

    private companion object {
        const val REQUIRED_KEY_BYTES = 32
        const val NONCE_BYTES = 12
        const val TAG_BITS = 128
        const val FORMAT_VERSION: Byte = 1
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
