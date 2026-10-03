package ai.taskpilot.coreapi

import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.ActiveProfiles
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import kotlin.test.assertEquals

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("production")
class ProductionOpenApiIntegrationTest(
    @param:LocalServerPort private val port: Int,
) {
    private val client =
        HttpClient
            .newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build()

    @Test
    fun `production profile does not expose OpenAPI or Swagger UI`() {
        listOf("/v3/api-docs", "/swagger-ui/index.html", "/swagger-ui/swagger-initializer.js").forEach { path ->
            val request =
                HttpRequest
                    .newBuilder(URI("http://127.0.0.1:$port$path"))
                    .timeout(Duration.ofSeconds(2))
                    .GET()
                    .build()
            val response = client.send(request, HttpResponse.BodyHandlers.discarding())
            assertEquals(404, response.statusCode(), path)
        }
    }
}
