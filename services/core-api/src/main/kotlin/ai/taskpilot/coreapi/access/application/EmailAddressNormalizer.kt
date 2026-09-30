package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.EmailAddress
import ai.taskpilot.coreapi.access.model.InvalidEmailAddressException
import com.ibm.icu.lang.UCharacter
import java.net.IDN
import java.nio.charset.StandardCharsets
import java.util.Locale

class EmailAddressNormalizer {
    fun normalize(rawEmail: String): EmailAddress {
        val displayEmail = rawEmail.trim(Char::isWhitespace)
        val separator = displayEmail.indexOf('@')
        if (separator <= 0 || separator != displayEmail.lastIndexOf('@') || separator == displayEmail.lastIndex) {
            throw InvalidEmailAddressException()
        }

        val localPart = displayEmail.substring(0, separator)
        val domain = displayEmail.substring(separator + 1)
        validateLocalPart(localPart)
        val normalizedDomain = normalizeDomain(domain)
        val normalizedLocalPart = UCharacter.foldCase(localPart, true)
        val normalizedEmail = "$normalizedLocalPart@$normalizedDomain"
        if (normalizedEmail.toByteArray(StandardCharsets.UTF_8).size > MAX_EMAIL_BYTES) {
            throw InvalidEmailAddressException()
        }
        return EmailAddress(normalizedEmail, displayEmail)
    }

    private fun validateLocalPart(localPart: String) {
        val hasInvalidDotPlacement =
            localPart.startsWith('.') || localPart.endsWith('.') || localPart.contains("..")
        val exceedsResourceLimit = localPart.toByteArray(StandardCharsets.UTF_8).size > MAX_LOCAL_PART_BYTES
        if (hasInvalidDotPlacement || exceedsResourceLimit || localPart.any(::isForbiddenLocalCharacter)) {
            throw InvalidEmailAddressException()
        }
    }

    private fun normalizeDomain(domain: String): String {
        if (domain.startsWith('.') || domain.endsWith('.') || domain.contains("..")) {
            throw InvalidEmailAddressException()
        }
        val ascii =
            runCatching { IDN.toASCII(domain, IDN.USE_STD3_ASCII_RULES).lowercase(Locale.ROOT) }
                .getOrNull()
        if (ascii.isNullOrEmpty() || ascii.length > MAX_DOMAIN_ASCII_LENGTH) {
            throw InvalidEmailAddressException()
        }
        return ascii
    }

    private fun isForbiddenLocalCharacter(character: Char): Boolean =
        character.isWhitespace() ||
            character.isISOControl() ||
            character == '@' ||
            character in FORBIDDEN_LOCAL_CHARACTERS

    private companion object {
        const val MAX_LOCAL_PART_BYTES = 64
        const val MAX_DOMAIN_ASCII_LENGTH = 253
        const val MAX_EMAIL_BYTES = 254
        const val FORBIDDEN_LOCAL_CHARACTERS = "()<>[]:;\\,\""
    }
}
