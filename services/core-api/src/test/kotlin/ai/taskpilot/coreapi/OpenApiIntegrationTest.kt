package ai.taskpilot.coreapi

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.yaml.snakeyaml.LoaderOptions
import org.yaml.snakeyaml.Yaml
import org.yaml.snakeyaml.constructor.SafeConstructor
import tools.jackson.core.type.TypeReference
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Path
import java.time.Duration
import kotlin.io.path.bufferedReader
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["taskpilot.authentication.enabled=false"],
)
class OpenApiIntegrationTest(
    @param:LocalServerPort private val port: Int,
    @param:Autowired private val objectMapper: ObjectMapper,
) {
    private val client =
        HttpClient
            .newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build()

    @Test
    fun `served OpenAPI is semantically equal to the canonical source artifact`() {
        val response = get("/v3/api-docs")
        assertEquals(200, response.statusCode())
        assertTrue(
            response
                .headers()
                .firstValue("Content-Type")
                .orElse("")
                .startsWith("application/json"),
        )

        val served = objectMapper.readValue(response.body(), object : TypeReference<Map<String, Any?>>() {})
        val source = loadCanonicalSource()

        assertEquals(source, served)
        assertTrue((served["paths"] as? Map<*, *>)?.isNotEmpty() == true)
        assertTrue((served["components"] as? Map<*, *>)?.isNotEmpty() == true)
    }

    @Test
    fun `Swagger UI uses canonical docs and does not persist authorization`() {
        val swagger = get("/swagger-ui/swagger-initializer.js")
        assertEquals(200, swagger.statusCode())
        assertTrue(
            Regex("""["']?configUrl["']?\s*:\s*["']/v3/api-docs/swagger-config["']""")
                .containsMatchIn(swagger.body()),
            swagger.body(),
        )
        assertTrue(
            Regex("""["']?persistAuthorization["']?\s*:\s*false""").containsMatchIn(swagger.body()),
            swagger.body(),
        )

        val swaggerConfig = get("/v3/api-docs/swagger-config")
        assertEquals(200, swaggerConfig.statusCode())
        val config = objectMapper.readValue(swaggerConfig.body(), object : TypeReference<Map<String, Any?>>() {})
        assertEquals("/v3/api-docs", config["url"])
        assertEquals(false, config["persistAuthorization"])
    }

    private fun loadCanonicalSource(): Map<String, Any?> {
        val options =
            LoaderOptions().apply {
                isAllowDuplicateKeys = false
                maxAliasesForCollections = 0
                nestingDepthLimit = 100
                codePointLimit = 2_000_000
            }
        val path = Path.of(requireNotNull(System.getProperty("taskpilot.canonical-openapi-source")))
        val loaded = path.bufferedReader().use { Yaml(SafeConstructor(options)).load<Any?>(it) }
        @Suppress("UNCHECKED_CAST")
        return loaded as Map<String, Any?>
    }

    private fun get(path: String): HttpResponse<String> =
        client.send(
            HttpRequest
                .newBuilder(URI("http://127.0.0.1:$port$path"))
                .timeout(Duration.ofSeconds(2))
                .GET()
                .build(),
            HttpResponse.BodyHandlers.ofString(),
        )
}
