package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.PasswordDigest
import java.util.UUID

data class PasswordCredentialRecord(
    val userId: UUID,
    val digest: PasswordDigest,
)

fun interface PasswordCredentialReader {
    fun findByNormalizedEmail(normalizedEmail: String): PasswordCredentialRecord?
}

fun interface PasswordCredentialRehasher {
    fun replace(
        userId: UUID,
        expected: PasswordDigest,
        replacement: PasswordDigest,
    ): Boolean
}

enum class PasswordAuthenticationResult {
    AUTHENTICATED,
    INVALID_CREDENTIALS,
}

class PasswordAuthenticationService(
    private val reader: PasswordCredentialReader,
    private val rehasher: PasswordCredentialRehasher,
    private val passwordHasher: PasswordHasher,
    private val dummyDigest: PasswordDigest,
) {
    fun authenticate(
        normalizedEmail: String,
        password: CharSequence,
    ): PasswordAuthenticationResult {
        val credential = reader.findByNormalizedEmail(normalizedEmail)
        val digest = credential?.digest ?: dummyDigest
        if (!passwordHasher.matches(password, digest) || credential == null) {
            return PasswordAuthenticationResult.INVALID_CREDENTIALS
        }
        if (passwordHasher.needsUpgrade(digest)) {
            val replacement = passwordHasher.hash(password)
            rehasher.replace(credential.userId, digest, replacement)
        }
        return PasswordAuthenticationResult.AUTHENTICATED
    }
}
