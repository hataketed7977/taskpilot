package ai.taskpilot.coreapi

import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.postgresql.PostgreSQLContainer
import tools.jackson.core.type.TypeReference
import tools.jackson.databind.ObjectMapper
import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.Base64
import kotlin.test.assertEquals

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FederatedCapabilityDisabledHttpIntegrationTest(
    @param:LocalServerPort private val port: Int,
) {
    private val objectMapper = ObjectMapper()

    @AfterAll
    fun stopPostgreSql() = postgres.stop()

    @Test
    fun `missing GitHub configuration disables capability and attempt fails closed`() {
        val capability = request("GET", "/desktop/v1/auth/capabilities")
        assertEquals(200, capability.status)
        assertEquals(false, capability.json().nested("github")["enabled"])

        val attempt =
            request(
                "POST",
                "/desktop/v1/auth/federated/attempts",
                """
                {
                  "provider":"github",
                  "installationId":"test-installation",
                  "completionUri":"http://127.0.0.1:49152/taskpilot/oauth/complete/abcdefghijklmnopqrstuvwxyzABCDEF"
                }
                """.trimIndent(),
            )
        assertEquals(503, attempt.status)
        assertEquals("AUTHENTICATION_TEMPORARILY_UNAVAILABLE", attempt.json()["code"])
    }

    private fun request(
        method: String,
        path: String,
        body: String? = null,
    ): HttpResult {
        val connection = URI("http://127.0.0.1:$port$path").toURL().openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.setRequestProperty("Content-Type", "application/json")
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

    private fun HttpResult.json(): Map<String, Any?> {
        val responseType = object : TypeReference<Map<String, Any?>>() {}
        return objectMapper.readValue(body, responseType)
    }

    private fun Map<String, Any?>.nested(name: String): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        return getValue(name) as Map<String, Any?>
    }

    private data class HttpResult(
        val status: Int,
        val body: String,
    )

    companion object {
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }
        private val tokenPepper = Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
        private val hmacKey = Base64.getEncoder().encodeToString(ByteArray(32) { 31 })
        private val aeadKey = Base64.getEncoder().encodeToString(ByteArray(32) { 63 })

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
            registry.add("taskpilot.authentication.enabled") { "true" }
            registry.add("taskpilot.authentication.token-pepper-base64") { tokenPepper }
            registry.add("taskpilot.authentication.legal-bundle-version") { "2026-09" }
            registry.add("taskpilot.authentication.terms-version") { "terms-2026-09" }
            registry.add("taskpilot.authentication.privacy-version") { "privacy-2026-09" }
            registry.add("taskpilot.authentication.legal-locales") { "zh-CN,en" }
            registry.add("taskpilot.authentication.github.client-id") { "client-id" }
            registry.add("taskpilot.authentication.github.callback-uri") {
                "http://127.0.0.1:18080/desktop/v1/auth/federated/github/callback"
            }
            registry.add("taskpilot.authentication.github.hmac-key-base64") { hmacKey }
            registry.add("taskpilot.authentication.github.aead-key-base64") { aeadKey }
        }
    }
}
