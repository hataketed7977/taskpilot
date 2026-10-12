package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.FederatedIdentityProvider
import ai.taskpilot.coreapi.access.application.ProviderIdentity
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.data.redis.connection.RedisStandaloneConfiguration
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.GenericContainer
import org.testcontainers.postgresql.PostgreSQLContainer
import tools.jackson.core.type.TypeReference
import tools.jackson.databind.ObjectMapper
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Base64
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    classes = [CoreApiApplication::class, FakeFederatedProviderConfiguration::class],
)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AuthenticationHttpIntegrationTest(
    @param:LocalServerPort private val port: Int,
) {
    private val objectMapper = ObjectMapper()
    private lateinit var redisConnection: LettuceConnectionFactory

    @BeforeAll
    fun migrateSchema() {
        Flyway
            .configure()
            .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
            .locations("classpath:db/migration")
            .load()
            .migrate()
        redisConnection = LettuceConnectionFactory(RedisStandaloneConfiguration(redis.host, redis.getMappedPort(6379)))
        redisConnection.afterPropertiesSet()
    }

    @BeforeEach
    fun clearState() {
        postgres.createConnection("").use { connection ->
            connection.createStatement().use {
                it.execute(
                    "TRUNCATE access.terms_acceptances, access.external_identities, access.users CASCADE",
                )
            }
        }
        redisConnection.connection.serverCommands().flushAll()
    }

    @AfterAll
    fun stopContainers() {
        redisConnection.destroy()
        redis.stop()
        postgres.stop()
    }

    @Test
    fun `first GitHub sign in registers and returns an immediately active session`() {
        val completed = completeAttempt()
        val pending = poll(completed.created, completed.proof)
        assertEquals("REGISTRATION_REQUIRED", pending.json()["status"])
        val registration = pending.json().nested("registration")

        val authenticated =
            request(
                "POST",
                "/desktop/v1/auth/federated/registrations",
                """
                {
                  "continuationId":"${registration.requiredText("continuationId")}",
                  "continuationSecret":"${registration.requiredText("continuationSecret")}",
                  "displayName":"Octo Cat",
                  "useSuggestedAvatar":true,
                  "legalBundleVersion":"2026-09",
                  "termsVersion":"terms-2026-09",
                  "privacyVersion":"privacy-2026-09",
                  "locale":"zh-CN"
                }
                """.trimIndent(),
            )
        assertEquals(201, authenticated.status)
        assertEquals("AUTHENTICATED", authenticated.json()["status"])
        val session = authenticated.json().nested("session")
        val accessToken = session.requiredText("accessToken")
        val refreshToken = session.requiredText("refreshToken")

        val me = request("GET", "/desktop/v1/me", bearer = accessToken)
        assertEquals(200, me.status)
        assertEquals("Octo Cat", me.json()["displayName"])

        val refreshed =
            request(
                "POST",
                "/desktop/v1/auth/session/refresh",
                """{"refreshToken":"$refreshToken"}""",
            )
        assertEquals(200, refreshed.status)
        val rotated = refreshed.json()
        assertNotEquals(accessToken, rotated.requiredText("accessToken"))
        assertNotEquals(refreshToken, rotated.requiredText("refreshToken"))
        assertEquals(
            401,
            request("POST", "/desktop/v1/auth/session/refresh", """{"refreshToken":"$refreshToken"}""").status,
        )
        assertEquals(401, request("GET", "/desktop/v1/me", bearer = rotated.requiredText("accessToken")).status)
    }

    @Test
    fun `approved locales persist the exact legal quadruple and invalid combinations write nothing`() {
        listOf("zh-CN", "en").forEach(::registerAndAssertLegalQuadruple)

        listOf(
            mapOf("locale" to "fr"),
            mapOf("legalBundleVersion" to "old"),
            mapOf("termsVersion" to "old"),
            mapOf("privacyVersion" to "old"),
        ).forEach(::assertLegalBundleRejected)
    }

    @Test
    fun `known external identity signs in without registration`() {
        val first = completeAttempt()
        val preview = poll(first.created, first.proof).json().nested("registration")
        val registered =
            request(
                "POST",
                "/desktop/v1/auth/federated/registrations",
                registrationBody(preview),
            )
        assertEquals(201, registered.status)
        val registeredUserId =
            registered
                .json()
                .nested("session")
                .nested("currentUser")
                .requiredText("userId")

        val second = completeAttempt()
        val signedIn = poll(second.created, second.proof)
        assertEquals(200, signedIn.status)
        assertEquals("AUTHENTICATED", signedIn.json()["status"])
        assertEquals(
            registeredUserId,
            signedIn
                .json()
                .nested("session")
                .nested("currentUser")
                .requiredText("userId"),
        )
        assertNull(signedIn.json()["registration"])
    }

    @Test
    fun `cancel is terminal and clears the browser attempt`() {
        val created = createAttempt()
        val cancelled =
            request(
                "POST",
                "/desktop/v1/auth/federated/attempts/${created.requiredText("attemptId")}/cancel",
                """{"pollSecret":"${created.requiredText("pollSecret")}"}""",
            )
        assertEquals(204, cancelled.status)
        assertEquals("CANCELLED", poll(created, null).json()["status"])
        val state = URI(created.requiredText("authorizationUrl")).queryParameters().getValue("state")
        assertEquals(
            409,
            request("GET", "/desktop/v1/auth/federated/github/callback?state=${encode(state)}&code=late").status,
        )
    }

    @Test
    fun `attempt validates loopback completion URI and rate limits one installation`() {
        val invalid =
            request(
                "POST",
                "/desktop/v1/auth/federated/attempts",
                """{"provider":"github","installationId":"desktop-test","completionUri":"https://example.com/callback"}""",
            )
        assertEquals(400, invalid.status)
        repeat(5) {
            assertEquals(201, request("POST", "/desktop/v1/auth/federated/attempts", attemptBody("desktop-$it")).status)
        }
        val limited = request("POST", "/desktop/v1/auth/federated/attempts", attemptBody("desktop-over-limit"))
        assertEquals(429, limited.status)
        assertTrue(limited.json().requiredText("code") == "AUTHENTICATION_RATE_LIMITED")
    }

    private fun registerAndAssertLegalQuadruple(locale: String) {
        clearState()
        val completed = completeAttempt()
        val preview = poll(completed.created, completed.proof).json().nested("registration")
        val response =
            request(
                "POST",
                "/desktop/v1/auth/federated/registrations",
                registrationBody(preview, locale = locale),
            )
        assertEquals(201, response.status)
        assertPersistedLegalQuadruple(locale)
    }

    private fun assertLegalBundleRejected(overrides: Map<String, String>) {
        clearState()
        val completed = completeAttempt()
        val preview = poll(completed.created, completed.proof).json().nested("registration")
        val response =
            request(
                "POST",
                "/desktop/v1/auth/federated/registrations",
                registrationBody(
                    preview,
                    locale = overrides["locale"] ?: "zh-CN",
                    legalBundleVersion = overrides["legalBundleVersion"] ?: "2026-09",
                    termsVersion = overrides["termsVersion"] ?: "terms-2026-09",
                    privacyVersion = overrides["privacyVersion"] ?: "privacy-2026-09",
                ),
            )
        assertEquals(409, response.status)
        assertEquals("LEGAL_BUNDLE_REJECTED", response.json()["code"])
        listOf("users", "external_identities", "terms_acceptances").forEach { table ->
            assertEquals(0, persistedRowCount(table), table)
        }
    }

    private fun persistedRowCount(table: String): Int =
        postgres.createConnection("").use { connection ->
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT count(*) FROM access.$table").use { result ->
                    assertTrue(result.next())
                    result.getInt(1)
                }
            }
        }

    private fun assertPersistedLegalQuadruple(locale: String) {
        postgres.createConnection("").use { connection ->
            connection
                .prepareStatement(
                    "SELECT legal_bundle_version, terms_version, privacy_version, locale " +
                        "FROM access.terms_acceptances",
                ).use { statement ->
                    statement.executeQuery().use { result ->
                        assertTrue(result.next())
                        assertEquals("2026-09", result.getString("legal_bundle_version"))
                        assertEquals("terms-2026-09", result.getString("terms_version"))
                        assertEquals("privacy-2026-09", result.getString("privacy_version"))
                        assertEquals(locale, result.getString("locale"))
                        assertFalse(result.next())
                    }
                }
        }
    }

    private fun completeAttempt(): CompletedAttempt {
        val created = createAttempt()
        val state = URI(created.requiredText("authorizationUrl")).queryParameters().getValue("state")
        val callback = request("GET", "/desktop/v1/auth/federated/github/callback?state=${encode(state)}&code=code-1")
        assertEquals(200, callback.status)
        assertTrue(callback.body.contains("window.close()"))
        val proof =
            Regex("""const proof = "([^"]+)"""").find(callback.body)?.groupValues?.get(1)
                ?: error("missing completion proof")
        return CompletedAttempt(created, proof)
    }

    private fun createAttempt(): Map<String, Any?> {
        val response = request("POST", "/desktop/v1/auth/federated/attempts", attemptBody("desktop-test"))
        assertEquals(201, response.status)
        return response.json()
    }

    private fun attemptBody(installationId: String) =
        """{"provider":"github","installationId":"$installationId","completionUri":"$VALID_COMPLETION_URI"}"""

    private fun registrationBody(
        preview: Map<String, Any?>,
        locale: String = "zh-CN",
        legalBundleVersion: String = "2026-09",
        termsVersion: String = "terms-2026-09",
        privacyVersion: String = "privacy-2026-09",
    ) = """
        {
          "continuationId":"${preview.requiredText("continuationId")}",
          "continuationSecret":"${preview.requiredText("continuationSecret")}",
          "displayName":"Octo Cat",
          "useSuggestedAvatar":true,
          "legalBundleVersion":"$legalBundleVersion",
          "termsVersion":"$termsVersion",
          "privacyVersion":"$privacyVersion",
          "locale":"$locale"
        }
        """.trimIndent()

    private fun poll(
        created: Map<String, Any?>,
        proof: String?,
    ): HttpResult =
        request(
            "POST",
            "/desktop/v1/auth/federated/attempts/${created.requiredText("attemptId")}/poll",
            """{"pollSecret":"${created.requiredText(
                "pollSecret",
            )}"${proof?.let { ",\"completionProof\":\"$it\"" }.orEmpty()}}""",
        )

    private fun request(
        method: String,
        path: String,
        body: String? = null,
        bearer: String? = null,
    ): HttpResult {
        val connection = URI("http://127.0.0.1:$port$path").toURL().openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.setRequestProperty("Content-Type", "application/json")
        bearer?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
        }
        val status = connection.responseCode
        val responseBody =
            (if (status >= 400) connection.errorStream else connection.inputStream)
                ?.bufferedReader()
                ?.use { it.readText() }
                .orEmpty()
        return HttpResult(status, responseBody)
    }

    private fun HttpResult.json(): Map<String, Any?> = objectMapper.readValue(body, object : TypeReference<Map<String, Any?>>() {})

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.nested(name: String) = getValue(name) as Map<String, Any?>

    private fun Map<String, Any?>.requiredText(name: String) = requireNotNull(get(name)).toString()

    private fun URI.queryParameters() =
        query.split('&').associate { part ->
            part.substringBefore('=') to
                java.net.URLDecoder.decode(part.substringAfter('='), StandardCharsets.UTF_8)
        }

    private fun encode(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8)

    private data class CompletedAttempt(
        val created: Map<String, Any?>,
        val proof: String,
    )

    private data class HttpResult(
        val status: Int,
        val body: String,
    )

    companion object {
        private const val CALLBACK_URI = "http://127.0.0.1:18080/desktop/v1/auth/federated/github/callback"
        private const val VALID_COMPLETION_URI = "http://127.0.0.1:49152/taskpilot/oauth/complete/abcdefghijklmnopqrstuvwxyzABCDEF"
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }
        private val redis = AuthRedisContainer().withExposedPorts(6379).apply { start() }
        private val pepper = Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
        private val hmacKey = Base64.getEncoder().encodeToString(ByteArray(32) { 31 })
        private val aeadKey = Base64.getEncoder().encodeToString(ByteArray(32) { 63 })

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
            registry.add("spring.data.redis.host", redis::getHost)
            registry.add("spring.data.redis.port") { redis.getMappedPort(6379) }
            registry.add("taskpilot.authentication.enabled") { "true" }
            registry.add("taskpilot.authentication.token-pepper-base64") { pepper }
            registry.add("taskpilot.authentication.legal-bundle-version") { "2026-09" }
            registry.add("taskpilot.authentication.terms-version") { "terms-2026-09" }
            registry.add("taskpilot.authentication.privacy-version") { "privacy-2026-09" }
            registry.add("taskpilot.authentication.legal-locales") { "zh-CN,en" }
            registry.add("taskpilot.authentication.github.client-id") { "client-id" }
            registry.add("taskpilot.authentication.github.client-secret") { "client-secret" }
            registry.add("taskpilot.authentication.github.callback-uri") { CALLBACK_URI }
            registry.add("taskpilot.authentication.github.hmac-key-base64") { hmacKey }
            registry.add("taskpilot.authentication.github.aead-key-base64") { aeadKey }
        }
    }
}

private class AuthRedisContainer : GenericContainer<AuthRedisContainer>("redis:7.4-alpine")

@TestConfiguration(proxyBeanMethods = false)
class FakeFederatedProviderConfiguration {
    @Bean
    @Primary
    fun fakeFederatedIdentityProvider(): FederatedIdentityProvider =
        object : FederatedIdentityProvider {
            override fun authorizationUri(
                state: String,
                pkceChallenge: String,
            ): URI =
                URI(
                    "https://github.com/login/oauth/authorize?client_id=client-id&state=${encodeQuery(
                        state,
                    )}&code_challenge=${encodeQuery(pkceChallenge)}&code_challenge_method=S256",
                )

            override fun resolveIdentity(
                authorizationCode: String,
                pkceVerifier: String,
            ) = ProviderIdentity(
                "github",
                URI("https://github.com"),
                "123456",
                "Octo Cat",
                URI("https://avatars.githubusercontent.com/u/123456"),
            )
        }
}

private fun encodeQuery(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")
