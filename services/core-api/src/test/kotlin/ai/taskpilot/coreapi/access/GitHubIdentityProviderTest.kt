package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.FederatedProviderFailure
import ai.taskpilot.coreapi.access.application.FederatedProviderFailureCategory
import ai.taskpilot.coreapi.access.application.ProviderIdentity
import ai.taskpilot.coreapi.access.infrastructure.GitHubIdentityProvider
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.net.http.HttpClient
import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class GitHubIdentityProviderTest {
    private companion object {
        const val TOKEN_RESPONSE = "{\"access_token\":\"github-token-secret\"}"
    }

    @Test
    fun `authorization is fixed to github and requests no repository or email scopes`() {
        val provider = provider(URI("http://127.0.0.1:1"))
        val uri = provider.authorizationUri("state-secret", "pkce-challenge")

        assertEquals("https", uri.scheme)
        assertEquals("github.com", uri.host)
        assertEquals("/login/oauth/authorize", uri.path)
        assertTrue(uri.query.contains("state=state-secret"))
        assertTrue(uri.query.contains("code_challenge_method=S256"))
        assertFalse(uri.query.contains("repo"))
        assertFalse(uri.query.contains("user%3Aemail"))
    }

    @Test
    fun `token exchange maps only durable identity and safe suggested profile`() =
        withFakeGitHub(
            tokenResponse = "{\"access_token\":\"github-token-secret\",\"token_type\":\"bearer\"}",
            userResponse =
                """
                {"id":42,"login":"octocat","name":"Mona",
                 "avatar_url":"https://avatars.githubusercontent.com/u/42?v=4","email":"same@example.com"}
                """.trimIndent(),
        ) { baseUri ->
            val identity = provider(baseUri).resolveIdentity("authorization-code-secret", "pkce-verifier-secret")

            assertEquals(
                ProviderIdentity(
                    provider = "github",
                    authority = URI("https://github.com"),
                    subject = "42",
                    suggestedDisplayName = "Mona",
                    suggestedAvatarUrl = URI("https://avatars.githubusercontent.com/u/42?v=4"),
                ),
                identity,
            )
            assertFalse(identity.toString().contains("github-token-secret"))
            assertFalse(identity.toString().contains("same@example.com"))
        }

    @Test
    fun `profile fallbacks and avatar validation never change the durable subject`() {
        val cases =
            listOf(
                """{"id":42,"login":"octocat","name":"","avatar_url":"http://avatars.githubusercontent.com/u/42"}""" to
                    ("octocat" to null),
                """{"id":42,"login":"","name":"","avatar_url":"https://evil.example/u/42"}""" to
                    ("GitHub User" to null),
                """
                {"id":42,"login":"octocat","name":"Mona",
                 "avatar_url":"https://avatars.githubusercontent.com/u/43"}
                """.trimIndent() to ("Mona" to null),
                """{"id":42,"login":"octocat","name":"Mona","avatar_url":"not a uri"}""" to
                    ("Mona" to null),
                """
                {"id":42,"login":"octocat","name":"Mona",
                 "avatar_url":"https://user@avatars.githubusercontent.com/u/42"}
                """.trimIndent() to ("Mona" to null),
            )
        cases.forEach { (userResponse, expected) ->
            withFakeGitHub(
                tokenResponse = """{"access_token":"github-token-secret"}""",
                userResponse = userResponse,
            ) { baseUri ->
                val identity = provider(baseUri).resolveIdentity("code", "verifier")
                assertEquals("42", identity.subject)
                assertEquals(expected.first, identity.suggestedDisplayName)
                assertEquals(expected.second, identity.suggestedAvatarUrl)
            }
        }
    }

    @Test
    fun `display name is bounded and query-bearing matching avatar remains safe`() =
        withFakeGitHub(
            tokenResponse = """{"access_token":"github-token-secret"}""",
            userResponse =
                """
                {"id":42,"login":"octocat","name":"${"x".repeat(201)}",
                 "avatar_url":"https://avatars.githubusercontent.com/u/42?v=4"}
                """.trimIndent(),
        ) { baseUri ->
            val identity = provider(baseUri).resolveIdentity("code", "verifier")
            assertEquals(200, identity.suggestedDisplayName.length)
            assertEquals(
                URI("https://avatars.githubusercontent.com/u/42?v=4"),
                identity.suggestedAvatarUrl,
            )
        }

    @Test
    fun `invalid token and identity responses map to stable failure categories`() {
        val cases =
            listOf(
                providerCase("{}", "{}", FederatedProviderFailureCategory.AUTHORIZATION_REJECTED),
                providerCase("not-json", "{}", FederatedProviderFailureCategory.TEMPORARILY_UNAVAILABLE),
                providerCase(TOKEN_RESPONSE, "{}", FederatedProviderFailureCategory.IDENTITY_INVALID),
                providerCase(TOKEN_RESPONSE, "{\"id\":\"42\"}", FederatedProviderFailureCategory.IDENTITY_INVALID),
                providerCase(TOKEN_RESPONSE, "{\"id\":0}", FederatedProviderFailureCategory.IDENTITY_INVALID),
                providerCase(
                    TOKEN_RESPONSE,
                    "{}",
                    FederatedProviderFailureCategory.TEMPORARILY_UNAVAILABLE,
                    userStatus = 503,
                ),
            )
        cases.forEach { case ->
            withFakeGitHub(case.tokenResponse, case.userResponse, userStatus = case.userStatus) { baseUri ->
                val failure =
                    assertFailsWith<FederatedProviderFailure> {
                        provider(baseUri).resolveIdentity("authorization-code-secret", "pkce-verifier-secret")
                    }
                assertEquals(case.expected, failure.category)
            }
        }
    }

    @Test
    fun `provider rejects invalid construction inputs`() {
        val callback = URI("http://127.0.0.1:8080/callback")
        val client = HttpClient.newHttpClient()
        assertFailsWith<IllegalArgumentException> {
            GitHubIdentityProvider.forTesting("", "secret", callback, URI("http://127.0.0.1:1"), client)
        }
        assertFailsWith<IllegalArgumentException> {
            GitHubIdentityProvider.forTesting("id", "", callback, URI("http://127.0.0.1:1"), client)
        }
        assertFailsWith<IllegalArgumentException> {
            GitHubIdentityProvider.forTesting("id", "secret", URI("relative"), URI("http://127.0.0.1:1"), client)
        }
    }

    @Test
    fun `provider failures expose stable category without raw response or secrets`() =
        withFakeGitHub(
            tokenResponse = "{\"error\":\"bad_verification_code\",\"error_description\":\"authorization-code-secret\"}",
            tokenStatus = 400,
            userResponse = "{}",
        ) { baseUri ->
            val failure =
                assertFailsWith<FederatedProviderFailure> {
                    provider(baseUri).resolveIdentity("authorization-code-secret", "pkce-verifier-secret")
                }

            assertEquals(FederatedProviderFailureCategory.AUTHORIZATION_REJECTED, failure.category)
            assertFalse(failure.toString().contains("authorization-code-secret"))
            assertFalse(failure.toString().contains("pkce-verifier-secret"))
        }

    private fun provider(baseUri: URI) =
        GitHubIdentityProvider.forTesting(
            clientId = "client-id",
            clientSecret = "client-secret",
            callbackUri = URI("http://127.0.0.1:8080/desktop/v1/auth/federated/github/callback"),
            endpointBaseUri = baseUri,
            httpClient = HttpClient.newHttpClient(),
        )

    private fun providerCase(
        tokenResponse: String,
        userResponse: String,
        expected: FederatedProviderFailureCategory,
        userStatus: Int = 200,
    ) = ProviderCase(tokenResponse, userResponse, userStatus, expected)

    private data class ProviderCase(
        val tokenResponse: String,
        val userResponse: String,
        val userStatus: Int = 200,
        val expected: FederatedProviderFailureCategory,
    )

    private fun withFakeGitHub(
        tokenResponse: String,
        userResponse: String,
        tokenStatus: Int = 200,
        userStatus: Int = 200,
        action: (URI) -> Unit,
    ) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/login/oauth/access_token") { exchange ->
            exchange.requestBody.use { it.readAllBytes() }
            val body = tokenResponse.toByteArray(StandardCharsets.UTF_8)
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(tokenStatus, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.createContext("/user") { exchange ->
            assertEquals("Bearer github-token-secret", exchange.requestHeaders.getFirst("Authorization"))
            val body = userResponse.toByteArray(StandardCharsets.UTF_8)
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(userStatus, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        try {
            action(URI("http://127.0.0.1:${server.address.port}"))
        } finally {
            server.stop(0)
        }
    }
}
