package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.AttemptId
import ai.taskpilot.coreapi.access.model.ExternalIdentityKey
import ai.taskpilot.coreapi.access.model.UserId
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.time.Clock
import java.time.Instant
import java.util.UUID

class FederatedAuthenticationDependencies(
    private val configured: Boolean,
    securityFactory: () -> FederatedLoginSecurity,
    aeadFactory: () -> FederatedAead,
    private val providerFactory: () -> FederatedIdentityProvider,
    objectMapper: ObjectMapper,
    private val runtime: FederatedRuntimeDependencies,
) {
    val clock = runtime.clock
    val currentLegalDocuments = runtime.currentLegalDocuments
    val codec = FederatedAuthenticationCodec(aeadFactory, objectMapper)
    val security by lazy(securityFactory)
    val provider by lazy { providerFactory() }

    fun capabilityEnabled(): Boolean = configured && currentLegalDocuments.isValid()
}

data class LegalDocumentBundle(
    val legalBundleVersion: String,
    val termsVersion: String,
    val privacyVersion: String,
    val locale: String,
)

data class ApprovedLegalDocuments(
    val legalBundleVersion: String,
    val termsVersion: String,
    val privacyVersion: String,
    val locales: List<String>,
) {
    fun isValid(): Boolean =
        legalBundleVersion.isNotBlank() &&
            termsVersion.isNotBlank() &&
            privacyVersion.isNotBlank() &&
            locales.isNotEmpty() &&
            locales.size == locales.toSet().size &&
            locales.all { it in SUPPORTED_LEGAL_LOCALES }

    fun accepts(bundle: LegalDocumentBundle): Boolean =
        isValid() &&
            bundle.legalBundleVersion == legalBundleVersion &&
            bundle.termsVersion == termsVersion &&
            bundle.privacyVersion == privacyVersion &&
            bundle.locale in locales
}

data class FederatedRuntimeDependencies(
    val clock: Clock,
    val currentLegalDocuments: ApprovedLegalDocuments,
)

private val SUPPORTED_LEGAL_LOCALES = setOf("zh-CN", "en")

class FederatedAuthenticationCodec(
    aeadFactory: () -> FederatedAead,
    private val objectMapper: ObjectMapper,
) {
    private val aead by lazy(aeadFactory)

    fun encryptPkceVerifier(
        attemptId: AttemptId,
        verifier: String,
    ) = aead.encrypt(ad(attemptId, "pkce"), verifier.toByteArray())

    fun decryptPkceVerifier(
        attemptId: AttemptId,
        encrypted: ByteArray,
    ) = aead.decrypt(ad(attemptId, "pkce"), encrypted).toString(Charsets.UTF_8)

    fun encryptIdentity(
        attemptId: AttemptId,
        identity: ProviderIdentity,
    ) = aead.encrypt(
        ad(attemptId, "identity"),
        objectMapper.writeValueAsBytes(
            FederatedIdentityPayload(
                identity.provider,
                identity.authority,
                identity.subject,
                identity.suggestedDisplayName,
                identity.suggestedAvatarUrl,
            ),
        ),
    )

    fun readIdentity(
        attemptId: AttemptId,
        encrypted: ByteArray,
    ): FederatedIdentityPayload =
        objectMapper.readValue(aead.decrypt(ad(attemptId, "identity"), encrypted), FederatedIdentityPayload::class.java)

    fun encryptRegistrationResult(
        attemptId: AttemptId,
        result: FederatedRegistrationResultPayload,
    ) = aead.encrypt(ad(attemptId, "registration-result"), objectMapper.writeValueAsBytes(result))

    fun readRegistrationResult(
        attemptId: AttemptId,
        encrypted: ByteArray,
    ): FederatedRegistrationResultPayload =
        objectMapper.readValue(
            aead.decrypt(ad(attemptId, "registration-result"), encrypted),
            FederatedRegistrationResultPayload::class.java,
        )

    fun encryptAuthenticatedResult(
        attemptId: AttemptId,
        result: FederatedAuthenticatedResultPayload,
    ) = aead.encrypt(ad(attemptId, "authenticated-result"), objectMapper.writeValueAsBytes(result))

    fun readAuthenticatedResult(
        attemptId: AttemptId,
        encrypted: ByteArray,
    ): FederatedAuthenticatedResultPayload =
        objectMapper.readValue(
            aead.decrypt(ad(attemptId, "authenticated-result"), encrypted),
            FederatedAuthenticatedResultPayload::class.java,
        )

    private fun ad(
        attemptId: AttemptId,
        purpose: String,
    ) = "${attemptId.value}:$purpose:v1"
}

object FederatedAuthenticationInputPolicy {
    fun validCompletionUri(uri: URI): Boolean {
        val rawPath = uri.rawPath ?: return false
        return uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port in MIN_EPHEMERAL_PORT..MAX_PORT &&
            uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null && !rawPath.contains('%') &&
            !rawPath.contains("..") &&
            rawPath.matches(Regex("/taskpilot/oauth/complete/[A-Za-z0-9_-]{$MIN_COMPLETION_NONCE_LENGTH,$MAX_COMPLETION_NONCE_LENGTH}"))
    }

    fun validInstallationId(value: String) =
        value.length in 1..MAX_INSTALLATION_ID_LENGTH && value.all { it.isLetterOrDigit() || it in "-_.:" }

    private const val MIN_EPHEMERAL_PORT = 49_152
    private const val MAX_PORT = 65_535
    private const val MIN_COMPLETION_NONCE_LENGTH = 32
    private const val MAX_COMPLETION_NONCE_LENGTH = 128
    private const val MAX_INSTALLATION_ID_LENGTH = 200
}

data class FederatedIdentityPayload(
    val provider: String,
    val authority: URI,
    val subject: String,
    val suggestedDisplayName: String,
    val suggestedAvatarUrl: URI?,
) {
    fun key() = ExternalIdentityKey(provider, authority, subject)
}

data class FederatedRegistrationResultPayload(
    val continuationId: UUID,
    val continuationSecret: String,
    val suggestedDisplayName: String,
    val suggestedAvatarUrl: URI?,
    val legalBundleVersion: String,
    val expiresAt: Instant,
) {
    fun toPollResult() =
        FederatedPollResult.RegistrationRequired(
            continuationId,
            continuationSecret,
            suggestedDisplayName,
            suggestedAvatarUrl,
            legalBundleVersion,
            expiresAt,
        )
}

data class FederatedAuthenticatedResultPayload(
    val sessionId: UUID,
    val familyId: UUID,
    val accessToken: String,
    val accessTokenExpiresAt: Instant,
    val refreshToken: String,
    val refreshTokenExpiresAt: Instant,
    val currentUser: FederatedCurrentUserPayload,
) {
    fun toSession() =
        IssuedSession(
            SessionId(sessionId),
            SessionFamilyId(familyId),
            accessToken,
            accessTokenExpiresAt,
            refreshToken,
            refreshTokenExpiresAt,
            currentUser.toView(),
        )
}

data class FederatedCurrentUserPayload(
    val userId: UUID,
    val displayName: String,
    val avatarUrl: URI?,
) {
    fun toView() = CurrentUserView(UserId(userId), displayName, avatarUrl)
}
