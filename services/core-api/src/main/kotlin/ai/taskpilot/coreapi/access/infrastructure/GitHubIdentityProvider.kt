package ai.taskpilot.coreapi.access.infrastructure

import ai.taskpilot.coreapi.access.application.FederatedIdentityProvider
import ai.taskpilot.coreapi.access.application.FederatedProviderFailure
import ai.taskpilot.coreapi.access.application.FederatedProviderFailureCategory
import ai.taskpilot.coreapi.access.application.ProviderIdentity
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets

class GitHubIdentityProvider private constructor(
    private val client: OAuthClient,
    private val callbackUri: URI,
    private val endpoints: Endpoints,
    private val httpClient: HttpClient,
) : FederatedIdentityProvider {
    private val objectMapper = ObjectMapper()

    init {
        require(client.id.isNotBlank())
        require(client.secret.isNotEmpty())
        require(callbackUri.isAbsolute)
    }

    override fun authorizationUri(
        state: String,
        pkceChallenge: String,
    ): URI =
        URI.create(
            "${endpoints.authorization}?client_id=${client.id.urlEncode()}" +
                "&redirect_uri=${callbackUri.toASCIIString().urlEncode()}" +
                "&state=${state.urlEncode()}&code_challenge=${pkceChallenge.urlEncode()}&code_challenge_method=S256",
        )

    override fun resolveIdentity(
        authorizationCode: String,
        pkceVerifier: String,
    ): ProviderIdentity =
        try {
            val token = exchangeCode(authorizationCode, pkceVerifier)
            readIdentity(token)
        } catch (failure: FederatedProviderFailure) {
            throw failure
        } catch (_: Exception) {
            throw FederatedProviderFailure(FederatedProviderFailureCategory.TEMPORARILY_UNAVAILABLE)
        }

    private fun exchangeCode(
        authorizationCode: String,
        pkceVerifier: String,
    ): String {
        val body =
            "client_id=${client.id.urlEncode()}&client_secret=${String(client.secret).urlEncode()}" +
                "&code=${authorizationCode.urlEncode()}&redirect_uri=${callbackUri.toASCIIString().urlEncode()}" +
                "&code_verifier=${pkceVerifier.urlEncode()}"
        val response =
            httpClient.send(
                HttpRequest
                    .newBuilder(endpoints.token)
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build(),
                HttpResponse.BodyHandlers.ofString(),
            )
        if (response.statusCode() !in HTTP_SUCCESS_RANGE) {
            throw FederatedProviderFailure(FederatedProviderFailureCategory.AUTHORIZATION_REJECTED)
        }
        val node = objectMapper.readTree(response.body())
        val token = node.path("access_token").stringValue("")
        if (token.isBlank()) {
            throw FederatedProviderFailure(FederatedProviderFailureCategory.AUTHORIZATION_REJECTED)
        }
        return token
    }

    private fun readIdentity(accessToken: String): ProviderIdentity {
        val response =
            httpClient.send(
                HttpRequest
                    .newBuilder(endpoints.user)
                    .header("Accept", "application/vnd.github+json")
                    .header("Authorization", "Bearer $accessToken")
                    .GET()
                    .build(),
                HttpResponse.BodyHandlers.ofString(),
            )
        if (response.statusCode() !in HTTP_SUCCESS_RANGE) {
            throw FederatedProviderFailure(FederatedProviderFailureCategory.TEMPORARILY_UNAVAILABLE)
        }
        val node = objectMapper.readTree(response.body())
        val idNode = node.path("id")
        val subject =
            idNode
                .takeIf { it.isIntegralNumber }
                ?.numberValue()
                ?.toString()
                ?.takeIf { it.matches(Regex("[1-9][0-9]*")) }
                ?: throw FederatedProviderFailure(FederatedProviderFailureCategory.IDENTITY_INVALID)
        val login = node.path("login").stringValue("").trim()
        val name = node.path("name").stringValue("").trim()
        val avatar = safeAvatar(node.path("avatar_url").stringValue(""), subject)
        return ProviderIdentity(
            provider = PROVIDER,
            authority = AUTHORITY,
            subject = subject,
            suggestedDisplayName = name.ifBlank { login }.ifBlank { "GitHub User" }.take(MAX_DISPLAY_NAME),
            suggestedAvatarUrl = avatar,
        )
    }

    private fun safeAvatar(
        raw: String,
        subject: String,
    ): URI? =
        runCatching { URI(raw) }
            .getOrNull()
            ?.takeIf {
                it.scheme == "https" && it.host == "avatars.githubusercontent.com" &&
                    it.path == "/u/$subject" && it.userInfo == null
            }

    private data class OAuthClient(
        val id: String,
        val secret: CharArray,
    )

    private data class Endpoints(
        val authorization: URI,
        val token: URI,
        val user: URI,
    )

    companion object {
        private const val PROVIDER = "github"
        private const val MAX_DISPLAY_NAME = 200
        private const val HTTP_SUCCESS_MIN = 200
        private const val HTTP_SUCCESS_MAX = 299
        private val HTTP_SUCCESS_RANGE = HTTP_SUCCESS_MIN..HTTP_SUCCESS_MAX
        private val AUTHORITY = URI("https://github.com")
        private val PRODUCTION_ENDPOINTS =
            Endpoints(
                authorization = URI("https://github.com/login/oauth/authorize"),
                token = URI("https://github.com/login/oauth/access_token"),
                user = URI("https://api.github.com/user"),
            )

        fun create(
            clientId: String,
            clientSecret: String,
            callbackUri: URI,
            httpClient: HttpClient = HttpClient.newHttpClient(),
        ): GitHubIdentityProvider =
            GitHubIdentityProvider(
                OAuthClient(clientId, clientSecret.toCharArray()),
                callbackUri,
                PRODUCTION_ENDPOINTS,
                httpClient,
            )

        fun forTesting(
            clientId: String,
            clientSecret: String,
            callbackUri: URI,
            endpointBaseUri: URI,
            httpClient: HttpClient,
        ): GitHubIdentityProvider =
            GitHubIdentityProvider(
                OAuthClient(clientId, clientSecret.toCharArray()),
                callbackUri,
                Endpoints(
                    authorization = URI("https://github.com/login/oauth/authorize"),
                    token = endpointBaseUri.resolve("/login/oauth/access_token"),
                    user = endpointBaseUri.resolve("/user"),
                ),
                httpClient,
            )
    }
}

private fun String.urlEncode(): String = URLEncoder.encode(this, StandardCharsets.UTF_8).replace("+", "%20")
