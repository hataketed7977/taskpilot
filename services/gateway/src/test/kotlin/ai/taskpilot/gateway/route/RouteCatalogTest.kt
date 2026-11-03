package ai.taskpilot.gateway.route

import org.springframework.core.io.ByteArrayResource
import org.springframework.core.io.ClassPathResource
import org.springframework.http.HttpMethod
import tools.jackson.databind.json.JsonMapper
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class RouteCatalogTest {
    private val objectMapper = JsonMapper.builder().build()

    @Test
    fun `packaged generated manifest loads as a non-empty immutable catalog`() {
        val catalog = RouteCatalog.load(ClassPathResource("canonical-api/canonical-routes.json"), objectMapper)

        assertTrue(catalog.routes.isNotEmpty())
        assertTrue(catalog.contains(HttpMethod.GET, "/v1/me"))
        assertTrue(catalog.routes.any { it.ingress == "provider-callback" })
    }

    @Test
    fun `missing malformed and empty manifests fail closed`() {
        assertFailsWith<IllegalStateException> {
            RouteCatalog.load(ClassPathResource("missing-routes.json"), objectMapper)
        }
        assertFailsWith<IllegalStateException> {
            RouteCatalog.load(resource("not-json"), objectMapper)
        }
        assertFailsWith<IllegalArgumentException> {
            RouteCatalog.load(resource("[]"), objectMapper)
        }
    }

    @Test
    fun `duplicate method path fails closed`() {
        val route = routeJson()
        val error =
            assertFailsWith<IllegalArgumentException> {
                RouteCatalog.load(resource("[$route,$route]"), objectMapper)
            }

        assertTrue(error.message.orEmpty().contains("duplicate method/path"))
    }

    @Test
    fun `invalid manifest fields fail closed`() {
        listOf(
            routeJson(method = "TRACE"),
            routeJson(path = "/v1/**"),
            routeJson(operationId = "not-valid!"),
            routeJson(ingress = "none"),
            """{"method":"GET","path":"/v1/me","operationId":"me"}""",
            """{"method":"GET","path":"/v1/me","operationId":"me","ingress":"canonical","extra":true}""",
        ).forEach { manifestEntry ->
            assertFailsWith<IllegalArgumentException>(manifestEntry) {
                RouteCatalog.load(resource("[$manifestEntry]"), objectMapper)
            }
        }
    }

    @Test
    fun `path templates match concrete paths but not wrong methods`() {
        val catalog = RouteCatalog.load(resource("[${routeJson(path = "/v1/projects/{projectId}")}]"), objectMapper)

        assertEquals(true, catalog.contains(HttpMethod.GET, "/v1/projects/project-1"))
        assertEquals(false, catalog.contains(HttpMethod.POST, "/v1/projects/project-1"))
    }

    private fun routeJson(
        method: String = "GET",
        path: String = "/v1/me",
        operationId: String = "currentUser",
        ingress: String = "canonical",
    ): String = """{"method":"$method","path":"$path","operationId":"$operationId","ingress":"$ingress"}"""

    private fun resource(content: String) = ByteArrayResource(content.toByteArray())
}
