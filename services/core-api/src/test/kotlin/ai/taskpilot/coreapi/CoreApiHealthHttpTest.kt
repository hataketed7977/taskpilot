package ai.taskpilot.coreapi

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.actuate.endpoint.web.WebEndpointsSupplier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.net.HttpURLConnection
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(SecurityProbeController::class)
class CoreApiHealthHttpTest(
    @param:LocalServerPort private val port: Int,
) {
    @Autowired
    private lateinit var webEndpointsSupplier: WebEndpointsSupplier

    @Test
    fun `health probes are public while every other route is denied and actuator stays restricted`() {
        assertEquals(200, get("/actuator/health/liveness").first)
        assertEquals(200, get("/actuator/health/readiness").first)
        assertEquals(403, get("/test-only/security-probe").first)
        assertEquals(setOf("health"), webEndpointsSupplier.endpoints.map { it.endpointId.toString() }.toSet())
    }

    private fun get(path: String): Pair<Int, String> {
        val connection = URI("http://127.0.0.1:$port$path").toURL().openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        val status = connection.responseCode
        val body =
            (
                if (status >= 400) {
                    connection.errorStream
                } else {
                    connection.inputStream
                }
            )?.bufferedReader()?.use { it.readText() }.orEmpty()
        return status to body
    }
}

@RestController
internal class SecurityProbeController {
    @GetMapping("/test-only/security-probe")
    fun probe() = "reachable-only-if-security-allows-it"
}
