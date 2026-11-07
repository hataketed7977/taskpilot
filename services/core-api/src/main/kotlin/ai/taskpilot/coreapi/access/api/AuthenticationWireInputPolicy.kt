package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.AuthenticationProblemException
import org.springframework.http.HttpStatus

internal object AuthenticationWireInputPolicy {
    private const val MAXIMUM_CREDENTIAL_LENGTH = 512
    private const val MAXIMUM_LEGAL_VERSION_LENGTH = 128
    private const val MAXIMUM_LOCALE_LENGTH = 35

    fun refreshToken(value: String) = requireMaximum(value, MAXIMUM_CREDENTIAL_LENGTH, "refreshToken")

    fun pollSecret(value: String) = requireMinimum(value, 1, "pollSecret")

    fun registration(
        continuationSecret: String,
        legalBundleVersion: String,
        termsVersion: String,
        privacyVersion: String,
        locale: String,
    ) {
        requireMaximum(continuationSecret, MAXIMUM_CREDENTIAL_LENGTH, "continuationSecret")
        requireMaximum(legalBundleVersion, MAXIMUM_LEGAL_VERSION_LENGTH, "legalBundleVersion")
        requireMaximum(termsVersion, MAXIMUM_LEGAL_VERSION_LENGTH, "termsVersion")
        requireMaximum(privacyVersion, MAXIMUM_LEGAL_VERSION_LENGTH, "privacyVersion")
        requireMaximum(locale, MAXIMUM_LOCALE_LENGTH, "locale")
    }

    private fun requireMinimum(
        value: String,
        minimumCodePoints: Int,
        path: String,
    ) {
        if (value.codePointCount(0, value.length) < minimumCodePoints) invalid(path)
    }

    private fun requireMaximum(
        value: String,
        maximumCodePoints: Int,
        path: String,
    ) {
        if (value.codePointCount(0, value.length) > maximumCodePoints) invalid(path)
    }

    private fun invalid(path: String): Nothing = throw AuthenticationProblemException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", path)
}
