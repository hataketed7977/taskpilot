package ai.taskpilot.coreapi.access.application

import java.net.URI

data class ProviderIdentity(
    val provider: String,
    val authority: URI,
    val subject: String,
    val suggestedDisplayName: String,
    val suggestedAvatarUrl: URI?,
)

interface FederatedIdentityProvider {
    fun authorizationUri(
        state: String,
        pkceChallenge: String,
    ): URI

    fun resolveIdentity(
        authorizationCode: String,
        pkceVerifier: String,
    ): ProviderIdentity
}

enum class FederatedProviderFailureCategory {
    AUTHORIZATION_REJECTED,
    IDENTITY_INVALID,
    TEMPORARILY_UNAVAILABLE,
}

class FederatedProviderFailure(
    val category: FederatedProviderFailureCategory,
) : RuntimeException(category.name)
