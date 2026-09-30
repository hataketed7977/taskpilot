package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.EmailAddressNormalizer
import ai.taskpilot.coreapi.access.model.InvalidEmailAddressException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class EmailAddressNormalizerTest {
    private val normalizer = EmailAddressNormalizer()

    @Test
    fun `trims display input and canonicalizes unicode local part and IDNA domain`() {
        val result = normalizer.normalize("  Straße@BÜCHER.example  ")

        assertEquals("strasse@xn--bcher-kva.example", result.normalized)
        assertEquals("Straße@BÜCHER.example", result.display)
    }

    @Test
    fun `full case folding makes Greek sigma forms share one identity key`() {
        val capital = normalizer.normalize("ΟΣ@example.com")
        val finalSigma = normalizer.normalize("ος@EXAMPLE.COM")
        val regularSigma = normalizer.normalize("οσ@example.com")

        assertEquals(capital.normalized, finalSigma.normalized)
        assertEquals(capital.normalized, regularSigma.normalized)
    }

    @Test
    fun `does not apply provider-specific dot or plus alias folding`() {
        assertEquals("first.last+tag@gmail.com", normalizer.normalize("First.Last+tag@GMAIL.COM").normalized)
        assertEquals("firstlast@gmail.com", normalizer.normalize("firstlast@gmail.com").normalized)
    }

    @Test
    fun `rejects ambiguous malformed and resource-exhausting addresses`() {
        listOf(
            "",
            "missing-at.example.com",
            "two@@example.com",
            ".leading@example.com",
            "trailing.@example.com",
            "double..dot@example.com",
            "white space@example.com",
            "user@-example.com",
            "user@example..com",
            "${"a".repeat(65)}@example.com",
        ).forEach { rawEmail ->
            assertFailsWith<InvalidEmailAddressException>(rawEmail) {
                normalizer.normalize(rawEmail)
            }
        }
    }

    @Test
    fun `does not reveal email through value object string representation`() {
        val email = normalizer.normalize("private@example.com")

        assertEquals("EmailAddress([REDACTED])", email.toString())
    }
}
