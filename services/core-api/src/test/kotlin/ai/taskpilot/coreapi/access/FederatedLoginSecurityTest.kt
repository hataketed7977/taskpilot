package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.FederatedAead
import ai.taskpilot.coreapi.access.application.FederatedAuthenticationInputPolicy
import ai.taskpilot.coreapi.access.application.FederatedLoginSecurity
import ai.taskpilot.coreapi.access.application.FederatedSecretPurpose
import ai.taskpilot.coreapi.access.application.LegalDocumentBundle
import ai.taskpilot.coreapi.access.application.SessionPolicy
import ai.taskpilot.coreapi.access.infrastructure.FederatedAuthenticationProperties
import java.net.URI
import java.time.Duration
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class FederatedLoginSecurityTest {
    private val hmacKey = ByteArray(32) { (it + 1).toByte() }
    private val aeadKey = ByteArray(32) { (it + 65).toByte() }
    private val security = FederatedLoginSecurity(hmacKey)
    private val cipher = FederatedAead(aeadKey)

    @Test
    fun `desktop callback and installation inputs accept only their exact bounded forms`() {
        val validPath = "/taskpilot/oauth/complete/abcdefghijklmnopqrstuvwxyzABCDEF"
        listOf(49_152, 65_535).forEach { port ->
            assertTrue(FederatedAuthenticationInputPolicy.validCompletionUri(URI("http://127.0.0.1:$port$validPath")))
        }
        listOf(
            URI("mailto:taskpilot"),
            URI("http://127.0.0.1:49151$validPath"),
            URI("http://127.0.0.1:65536$validPath"),
            URI("http://127.0.0.1:49152/taskpilot/oauth/complete/%41bcdefghijklmnopqrstuvwxyzABCDE"),
            URI("http://127.0.0.1:49152/taskpilot/oauth/complete/abcdefghijklmnopqrstuvwxyzABCDE!"),
        ).forEach { uri ->
            assertFalse(FederatedAuthenticationInputPolicy.validCompletionUri(uri), uri.toString())
        }

        listOf("desktop", "desktop-1_test.example:dev", "x".repeat(200)).forEach {
            assertTrue(FederatedAuthenticationInputPolicy.validInstallationId(it), it)
        }
        listOf("", "has space", "slash/not-allowed", "x".repeat(201)).forEach {
            assertFalse(FederatedAuthenticationInputPolicy.validInstallationId(it), it)
        }
    }

    @Test
    fun `completion URI rejects every authority and path escape independently`() {
        val validPath = "/taskpilot/oauth/complete/abcdefghijklmnopqrstuvwxyzABCDEF"
        listOf(
            URI("https://127.0.0.1:49152$validPath"),
            URI("http://localhost:49152$validPath"),
            URI("http://user@127.0.0.1:49152$validPath"),
            URI("http://127.0.0.1:49152$validPath?proof=x"),
            URI("http://127.0.0.1:49152$validPath#fragment"),
            URI("http://127.0.0.1:49152/taskpilot/oauth/complete/../abcdefghijklmnopqrstuvwxyzABCDEF"),
            URI("http://127.0.0.1:49152/taskpilot/oauth/complete/${"x".repeat(31)}"),
            URI("http://127.0.0.1:49152/taskpilot/oauth/complete/${"x".repeat(129)}"),
        ).forEach { uri ->
            assertFalse(FederatedAuthenticationInputPolicy.validCompletionUri(uri), uri.toString())
        }
    }

    @Test
    fun `legal bundle and session policy reject incomplete unsafe configuration`() {
        assertTrue(LegalDocumentBundle("bundle", "terms", "privacy", "zh-CN").isValid())
        assertFalse(LegalDocumentBundle("", "terms", "privacy", "zh-CN").isValid())
        assertFalse(LegalDocumentBundle("bundle", "", "privacy", "zh-CN").isValid())
        assertFalse(LegalDocumentBundle("bundle", "terms", "", "zh-CN").isValid())
        assertFalse(LegalDocumentBundle("bundle", "terms", "privacy", "").isValid())

        assertFailsWith<IllegalArgumentException> {
            SessionPolicy(Duration.ZERO, Duration.ofDays(1), Duration.ofDays(2))
        }
        assertFailsWith<IllegalArgumentException> {
            SessionPolicy(Duration.ofMinutes(1), Duration.ZERO, Duration.ofDays(2))
        }
        assertFailsWith<IllegalArgumentException> {
            SessionPolicy(Duration.ofMinutes(1), Duration.ofDays(2), Duration.ofDays(1))
        }
    }

    @Test
    fun `digest namespaces keep every browser and delivery proof separate`() {
        val secret = "same-high-entropy-secret"
        val digests =
            FederatedSecretPurpose.entries
                .associateWith { security.digest(it, secret) }
                .values

        assertTrue(digests.all { it.length >= 43 })
        assertTrue(digests.toSet().size == FederatedSecretPurpose.entries.size)
    }

    @Test
    fun `pkce uses S256 and never exposes the verifier as challenge`() {
        val verifier = security.newPkceVerifier()
        val challenge = security.pkceS256(verifier)

        assertTrue(verifier.length in 43..128)
        assertNotEquals(verifier, challenge)
        assertFalse(challenge.contains("="))
    }

    @Test
    fun `identity and delivery payloads use AEAD associated data`() {
        val plaintext = "provider=github;subject=42".toByteArray()
        val encrypted = cipher.encrypt("attempt-1:identity:v1", plaintext)

        assertContentEquals(plaintext, cipher.decrypt("attempt-1:identity:v1", encrypted))
        kotlin.test.assertFails { cipher.decrypt("attempt-2:identity:v1", encrypted) }
        assertFalse(encrypted.toString(Charsets.UTF_8).contains("subject=42"))
    }

    @Test
    fun `capability is disabled unless github hmac and aead configuration is complete and separate`() {
        val encodedHmac = Base64.getEncoder().encodeToString(hmacKey)
        val encodedAead = Base64.getEncoder().encodeToString(aeadKey)
        val complete =
            FederatedAuthenticationProperties(
                clientId = "client-id",
                clientSecret = "client-secret",
                callbackUri = URI("http://127.0.0.1:8080/desktop/v1/auth/federated/github/callback"),
                hmacKeyBase64 = encodedHmac,
                aeadKeyBase64 = encodedAead,
            )

        assertTrue(complete.capabilityEnabled())
        assertFalse(complete.copy(clientSecret = "").capabilityEnabled())
        assertFalse(complete.copy(hmacKeyBase64 = "not-base64").capabilityEnabled())
        assertFalse(complete.copy(aeadKeyBase64 = encodedHmac).capabilityEnabled())
        assertFalse(complete.copy(callbackUri = URI("https://evil.example/callback")).capabilityEnabled())
    }

    @Test
    fun `configuration validates every credential key and callback boundary`() {
        val encodedHmac = Base64.getEncoder().encodeToString(hmacKey)
        val encodedAead = Base64.getEncoder().encodeToString(aeadKey)
        val complete =
            FederatedAuthenticationProperties(
                clientId = "client-id",
                clientSecret = "client-secret",
                callbackUri = URI("http://127.0.0.1:8080/desktop/v1/auth/federated/github/callback"),
                hmacKeyBase64 = encodedHmac,
                aeadKeyBase64 = encodedAead,
            )

        assertFalse(complete.copy(clientId = "").capabilityEnabled())
        assertFalse(complete.copy(callbackUri = null).capabilityEnabled())
        val callbackPath = "/desktop/v1/auth/federated/github/callback"
        assertFalse(complete.copy(callbackUri = URI("http://localhost:8080$callbackPath")).capabilityEnabled())
        assertFalse(complete.copy(callbackUri = URI("http://127.0.0.1:1023$callbackPath")).capabilityEnabled())
        assertFalse(complete.copy(callbackUri = URI("http://127.0.0.1:8080/wrong")).capabilityEnabled())
        assertFalse(complete.copy(callbackUri = URI("http://127.0.0.1:8080$callbackPath?q=1")).capabilityEnabled())
        assertFalse(complete.copy(callbackUri = URI("http://127.0.0.1:8080$callbackPath#fragment")).capabilityEnabled())
        assertFalse(complete.copy(callbackUri = URI("http://user@127.0.0.1:8080$callbackPath")).capabilityEnabled())
        assertFalse(
            complete.copy(hmacKeyBase64 = Base64.getEncoder().encodeToString(ByteArray(31))).capabilityEnabled(),
        )
        assertFalse(complete.copy(aeadKeyBase64 = "not-base64").capabilityEnabled())
        assertFalse(
            complete.copy(aeadKeyBase64 = Base64.getEncoder().encodeToString(ByteArray(31))).capabilityEnabled(),
        )

        assertTrue(complete.security { count -> "x".repeat(count) }.newSecret().isNotBlank())
        val plaintext = "payload".toByteArray()
        assertContentEquals(plaintext, complete.aead().let { it.decrypt("context", it.encrypt("context", plaintext)) })
        assertEquals("github.com", complete.provider().authorizationUri("state", "challenge").host)

        val incomplete = complete.copy(clientSecret = "")
        assertFailsWith<IllegalStateException> { incomplete.security() }
        assertFailsWith<IllegalStateException> { incomplete.aead() }
        assertFailsWith<IllegalStateException> { incomplete.provider() }
    }
}
