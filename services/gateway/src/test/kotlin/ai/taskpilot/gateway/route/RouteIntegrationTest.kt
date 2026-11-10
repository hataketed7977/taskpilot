package ai.taskpilot.gateway.route

import ai.taskpilot.gateway.transport.TransportPolicyFilter
import io.netty.buffer.Unpooled
import io.netty.handler.codec.http.HttpResponseStatus
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.reactive.server.WebTestClient
import reactor.core.publisher.Flux
import reactor.core.publisher.Mono
import reactor.netty.DisposableServer
import reactor.netty.http.client.HttpClient
import reactor.netty.http.server.HttpServer
import java.net.URI
import java.time.Duration
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension::class)
class RouteIntegrationTest(
    @param:LocalServerPort private val port: Int,
    @param:Autowired private val routeCatalog: RouteCatalog,
) {
    private val client by lazy {
        WebTestClient
            .bindToServer()
            .baseUrl("http://127.0.0.1:$port")
            .responseTimeout(Duration.ofSeconds(3))
            .build()
    }

    @BeforeEach
    fun clearRecords() = records.clear()

    @AfterAll
    fun stopStub() = stub.disposeNow()

    @Test
    fun `refresh logout reaches Core unchanged without injecting bearer identity`() {
        val body = """{"refreshToken":"opaque-refresh"}"""
        client
            .post()
            .uri("/v1/session:logout")
            .contentType(MediaType.APPLICATION_JSON)
            .bodyValue(body)
            .exchange()
            .expectStatus()
            .isOk
        val observed = records.last()
        assertEquals("POST", observed.method)
        assertEquals("/v1/session:logout", observed.uri)
        assertEquals(body, observed.body)
        assertTrue(observed.headers.keys.none { it.equals("authorization", ignoreCase = true) })
    }

    @Test
    fun `every canonical route preserves method path query and body exactly once`() {
        routeCatalog.routes.forEachIndexed { index, route ->
            val path = concretePath(route.path, index)
            val body = "{\"route\":$index}"
            client
                .method(route.method)
                .uri("$path?probe=$index")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus()
                .isOk
                .expectHeader()
                .contentType(MediaType.APPLICATION_JSON)

            val observed = records.poll(2, TimeUnit.SECONDS)
            assertNotNull(observed, "No upstream request for ${route.method} $path")
            assertEquals(route.method.name(), observed.method)
            assertEquals("$path?probe=$index", observed.uri)
            assertEquals(body, observed.body)
            assertTrue(records.isEmpty(), "${route.method} $path was forwarded more than once")
        }
    }

    @Test
    fun `unknown legacy wrong-method and management surfaces never reach Core`() {
        listOf(
            "GET" to "/desktop/v1/me",
            "GET" to "/v1/not-implemented",
            "POST" to "/v1/me",
            "GET" to "/v3/api-docs",
            "GET" to "/swagger-ui/index.html",
            "GET" to "/actuator/health",
            "GET" to "/actuator/env",
        ).forEach { (method, path) ->
            client
                .method(HttpMethod.valueOf(method))
                .uri(path)
                .exchange()
                .expectStatus()
                .isNotFound
                .expectHeader()
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .expectBody()
                .jsonPath("$.code")
                .isEqualTo("GATEWAY_ROUTE_NOT_FOUND")
            assertEquals(0, records.size, "$method $path reached Core")
        }
    }

    @Test
    fun `spoofed context is removed while credential and valid correlation reach Core`() {
        val correlation = "client.request-42"
        client
            .get()
            .uri("/v1/me")
            .header(HttpHeaders.AUTHORIZATION, "Bearer opaque-token")
            .header("X-Principal", "forged-principal")
            .header("X-User-Id", "forged-user")
            .header("X-Workspace-Id", "forged-workspace")
            .header("X-Project-Id", "forged-project")
            .header("X-Role", "ADMIN")
            .header("X-Tenant", "forged-tenant")
            .header("X-Internal-Origin", "forged-origin")
            .header("X-Forwarded-User", "forged-forwarded-user")
            .header("Forwarded", "for=attacker")
            .header("X-Real-IP", "203.0.113.4")
            .header("Cookie", "secret=cookie")
            .header(TransportPolicyFilter.CORRELATION_HEADER, correlation)
            .exchange()
            .expectStatus()
            .isOk
            .expectHeader()
            .valueEquals(TransportPolicyFilter.CORRELATION_HEADER, correlation)

        val observed = assertNotNull(records.poll(2, TimeUnit.SECONDS))
        assertEquals("Bearer opaque-token", observed.headers[HttpHeaders.AUTHORIZATION.lowercase()])
        assertEquals(correlation, observed.headers[TransportPolicyFilter.CORRELATION_HEADER.lowercase()])
        val forbiddenFragments =
            listOf("principal", "user-id", "workspace", "project", "role", "tenant", "internal-origin")
        assertTrue(observed.headers.keys.none { key -> forbiddenFragments.any(key::contains) })
        assertTrue("forwarded" !in observed.headers)
        assertTrue("x-real-ip" !in observed.headers)
        assertTrue("cookie" !in observed.headers)
    }

    @Test
    fun `invalid repeated and overlong correlation ids are replaced consistently`() {
        listOf(
            listOf("bad value", "second"),
            listOf("x".repeat(65)),
            listOf("/invalid"),
        ).forEach { supplied ->
            client
                .get()
                .uri("/v1/me")
                .headers { headers -> supplied.forEach { headers.add(TransportPolicyFilter.CORRELATION_HEADER, it) } }
                .exchange()
                .expectStatus()
                .isOk
                .expectHeader()
                .value(TransportPolicyFilter.CORRELATION_HEADER) { generated ->
                    assertTrue(generated.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,63}")))
                    assertTrue(generated !in supplied)
                    val observed = assertNotNull(records.poll(2, TimeUnit.SECONDS))
                    assertEquals(generated, observed.headers[TransportPolicyFilter.CORRELATION_HEADER.lowercase()])
                }
        }
    }

    @Test
    fun `declared request body accepts exact boundary and rejects first oversized byte before upstream`() {
        for (size in listOf(REQUEST_LIMIT - 1, REQUEST_LIMIT, REQUEST_LIMIT + 1)) {
            val status = streamedRequestStatus(size, RequestFraming.DECLARED)
            assertEquals(if (size <= REQUEST_LIMIT) 200 else 413, status, "declared request size $size")
            if (size <= REQUEST_LIMIT) {
                assertEquals(size, assertNotNull(records.poll(2, TimeUnit.SECONDS)).body.length)
            } else {
                assertTrue(records.isEmpty())
            }
        }
    }

    @Test
    fun `unknown length publisher and real chunked body enforce exact request boundary before upstream`() {
        for (framing in listOf(RequestFraming.UNKNOWN_LENGTH, RequestFraming.EXPLICIT_CHUNKED)) {
            for (size in listOf(REQUEST_LIMIT - 1, REQUEST_LIMIT, REQUEST_LIMIT + 1)) {
                val status = streamedRequestStatus(size, framing)
                assertEquals(if (size <= REQUEST_LIMIT) 200 else 413, status, "framing=$framing request size $size")
                if (size <= REQUEST_LIMIT) {
                    assertEquals(size, assertNotNull(records.poll(2, TimeUnit.SECONDS)).body.length)
                } else {
                    assertTrue(records.isEmpty())
                }
            }
        }
    }

    @Test
    fun `request headers are bounded before upstream`() {
        client
            .get()
            .uri("/v1/me")
            .header("X-Untrusted-Padding", "x".repeat(4100))
            .exchange()
            .expectStatus()
            .isEqualTo(431)
            .expectBody()
            .jsonPath("$.code")
            .isEqualTo("GATEWAY_REQUEST_HEADERS_TOO_LARGE")
        assertEquals(0, records.size)
    }

    @Test
    fun `business authentication authorization not-found and conflict problems pass through unchanged`() {
        mapOf(
            401 to "AUTHENTICATION_REQUIRED",
            403 to "PROJECT_ACCESS_FORBIDDEN",
            404 to "WORK_ITEM_NOT_FOUND",
            409 to "WORK_ITEM_VERSION_CONFLICT",
        ).forEach { (status, code) ->
            val expected =
                "{\"type\":\"https://taskpilot.ai/problems/business\",\"status\":$status," +
                    "\"code\":\"$code\",\"detail\":\"unchanged\"}"
            client
                .get()
                .uri("/v1/me?mode=problem&status=$status&code=$code")
                .exchange()
                .expectStatus()
                .isEqualTo(status)
                .expectHeader()
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .expectHeader()
                .valueEquals("X-Business-Header", "preserved")
                .expectBody(String::class.java)
                .isEqualTo(expected)
        }
    }

    @Test
    fun `dangerous upstream response headers are removed while business headers remain`() {
        listOf("response-headers" to 200, "response-headers-empty" to 204).forEach { (mode, status) ->
            client
                .get()
                .uri("/v1/me?mode=$mode")
                .exchange()
                .expectStatus()
                .isEqualTo(status)
                .expectHeader()
                .valueEquals("X-Business-Header", "preserved")
                .expectHeader()
                .doesNotExist(HttpHeaders.SET_COOKIE)
                .expectHeader()
                .doesNotExist("X-User-Id")
                .expectHeader()
                .doesNotExist("Forwarded")
                .expectHeader()
                .doesNotExist("X-Remove-Me")
                .expectHeader()
                .value(TransportPolicyFilter.CORRELATION_HEADER) { correlation ->
                    assertNotEquals("upstream-forged", correlation)
                }
        }
    }

    @Test
    fun `response body accepts exact boundary and rejects first oversized byte`() {
        for (size in listOf(RESPONSE_LIMIT - 1, RESPONSE_LIMIT, RESPONSE_LIMIT + 1)) {
            val response =
                client
                    .get()
                    .uri("/v1/me?mode=response-size&size=$size")
                    .exchange()
            if (size <= RESPONSE_LIMIT) {
                response.expectStatus().isOk.expectBody().consumeWith {
                    assertEquals(size, it.responseBody?.size)
                }
            } else {
                response
                    .expectStatus()
                    .isEqualTo(502)
                    .expectBody()
                    .jsonPath("$.code")
                    .isEqualTo("GATEWAY_RESPONSE_TOO_LARGE")
            }
        }
    }

    @Test
    fun `oversized response headers fail before response commit`() {
        client
            .get()
            .uri("/v1/me?mode=response-header")
            .exchange()
            .expectStatus()
            .isEqualTo(502)
            .expectBody()
            .jsonPath("$.code")
            .isEqualTo("GATEWAY_RESPONSE_HEADERS_TOO_LARGE")
    }

    @Test
    fun `slow disconnected and malformed upstream responses are stable and hide internal origin`() {
        mapOf(
            "slow" to 504,
            "disconnect" to 503,
            "truncated" to 504,
        ).forEach { (mode, status) ->
            client
                .get()
                .uri("/v1/me?mode=$mode")
                .exchange()
                .expectStatus()
                .isEqualTo(status)
                .expectBody()
                .consumeWith { result ->
                    val body = result.responseBody?.decodeToString().orEmpty()
                    assertFalse(body.contains("127.0.0.1"))
                    assertFalse(body.contains("PrematureClose"))
                    assertTrue(body.contains("correlationId"), "$mode response body: $body")
                }
        }
    }

    @Test
    fun `mutations are never retried when the upstream response is lost`() {
        val mutations = routeCatalog.routes.filter { it.method != HttpMethod.GET }
        mutations.forEachIndexed { index, route ->
            val path = concretePath(route.path, index)
            client
                .method(route.method)
                .uri("$path?mode=disconnect")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"mutation\":$index}")
                .exchange()
                .expectStatus()
                .isEqualTo(503)
            val observed =
                assertNotNull(
                    records.poll(2, TimeUnit.SECONDS),
                    "No upstream mutation for ${route.method} $path",
                )
            assertEquals(route.method.name(), observed.method)
            assertTrue(records.isEmpty(), "${route.method} $path was retried")
        }
    }

    @Test
    fun `credentials callback secrets cookies and bodies never enter logs or transport errors`(output: CapturedOutput) {
        val secrets = listOf("bearer-secret", "oauth-code-secret", "oauth-state-secret", "cookie-secret", "body-secret")
        client
            .post()
            .uri("/v1/session:refresh?mode=disconnect&code=${secrets[1]}&state=${secrets[2]}")
            .header(HttpHeaders.AUTHORIZATION, "Bearer ${secrets[0]}")
            .header(HttpHeaders.COOKIE, "session=${secrets[3]}")
            .contentType(MediaType.TEXT_PLAIN)
            .bodyValue(secrets[4])
            .exchange()
            .expectStatus()
            .isEqualTo(503)
            .expectBody()
            .consumeWith { response ->
                val body = response.responseBody?.decodeToString().orEmpty()
                secrets.forEach { assertFalse(body.contains(it)) }
                assertFalse(body.contains("127.0.0.1"))
            }
        secrets.forEach { assertFalse(output.all.contains(it), "secret leaked to captured logs") }
    }

    @Test
    fun `liveness is independent and readiness includes Core`() {
        client
            .get()
            .uri("/actuator/health/liveness")
            .exchange()
            .expectStatus()
            .isOk
        client
            .get()
            .uri("/actuator/health/readiness")
            .exchange()
            .expectStatus()
            .isOk
        assertTrue(records.any { it.uri == "/actuator/health/readiness" })
    }

    private fun streamedRequestStatus(
        size: Int,
        framing: RequestFraming,
    ): Int {
        val chunks = listOf("x".repeat(size / 2), "x".repeat(size - size / 2))
        val http =
            HttpClient
                .create()
                .baseUrl("http://127.0.0.1:$port")
                .headers { headers ->
                    headers[HttpHeaders.CONTENT_TYPE] = MediaType.TEXT_PLAIN_VALUE
                    when (framing) {
                        RequestFraming.DECLARED -> headers[HttpHeaders.CONTENT_LENGTH] = size.toString()
                        RequestFraming.EXPLICIT_CHUNKED -> headers[HttpHeaders.TRANSFER_ENCODING] = "chunked"
                        RequestFraming.UNKNOWN_LENGTH -> Unit
                    }
                }
        return assertNotNull(
            http
                .post()
                .uri("/v1/session:refresh")
                .send(Flux.fromIterable(chunks).map { Unpooled.wrappedBuffer(it.toByteArray()) })
                .responseSingle { response, body ->
                    body.asString().defaultIfEmpty("").map { response.status().code() }
                }.block(Duration.ofSeconds(3)),
        )
    }

    private fun concretePath(
        pattern: String,
        index: Int,
    ): String =
        pattern
            .replace("{workspaceId}", "workspace-$index")
            .replace("{projectId}", "project-$index")
            .replace("{boardId}", "board-$index")
            .replace("{columnId}", "column-$index")
            .replace("{workItemId}", "work-item-$index")
            .replace("{attemptId}", "attempt-$index")

    companion object {
        private const val REQUEST_LIMIT = 131_072
        private const val RESPONSE_LIMIT = 256
        private val records = LinkedBlockingQueue<ObservedRequest>()
        private val stub: DisposableServer =
            HttpServer
                .create()
                .host("127.0.0.1")
                .port(0)
                .handle { request, response ->
                    request.receive().aggregate().asString().defaultIfEmpty("").flatMap { body ->
                        records.add(
                            ObservedRequest(
                                request.method().name(),
                                request.uri(),
                                request.requestHeaders().associate { it.key.lowercase() to it.value },
                                body,
                            ),
                        )
                        val query = query(request.uri())
                        when (query["mode"]) {
                            "problem" -> {
                                val status = query["status"]?.toIntOrNull() ?: 409
                                val code = query["code"] ?: "WORK_ITEM_VERSION_CONFLICT"
                                response
                                    .status(HttpResponseStatus.valueOf(status))
                                    .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_PROBLEM_JSON_VALUE)
                                    .header("X-Business-Header", "preserved")
                                    .sendString(
                                        Mono.just(
                                            "{\"type\":\"https://taskpilot.ai/problems/business\",\"status\":$status," +
                                                "\"code\":\"$code\",\"detail\":\"unchanged\"}",
                                        ),
                                    ).then()
                            }

                            "response-headers", "response-headers-empty" -> {
                                val outbound =
                                    response
                                        .header("X-Business-Header", "preserved")
                                        .header(HttpHeaders.SET_COOKIE, "session=upstream-secret")
                                        .header("X-User-Id", "forged-user")
                                        .header("Forwarded", "for=upstream")
                                        .header(HttpHeaders.CONNECTION, "X-Remove-Me")
                                        .header("X-Remove-Me", "connection-nominated")
                                        .header(TransportPolicyFilter.CORRELATION_HEADER, "upstream-forged")
                                if (query["mode"] == "response-headers-empty") {
                                    outbound.status(HttpResponseStatus.NO_CONTENT).send().then()
                                } else {
                                    outbound.sendString(Mono.just("{}")).then()
                                }
                            }

                            "response-size" -> {
                                val size = query["size"]?.toIntOrNull() ?: 0
                                response
                                    .header(
                                        HttpHeaders.CONTENT_TYPE,
                                        MediaType.TEXT_PLAIN_VALUE,
                                    ).sendString(Mono.just("x".repeat(size)))
                                    .then()
                            }

                            "response-header" -> {
                                response
                                    .header("X-Oversized-Upstream", "x".repeat(4100))
                                    .sendString(Mono.just("ok"))
                                    .then()
                            }

                            "slow" -> {
                                Mono.delay(Duration.ofSeconds(1)).then(response.sendString(Mono.just("late")).then())
                            }

                            "disconnect" -> {
                                response.withConnection { it.dispose() }
                                response.send().then()
                            }

                            "truncated" -> {
                                response
                                    .header(HttpHeaders.CONTENT_LENGTH, "12")
                                    .sendString(Mono.just("short"))
                                    .then()
                            }

                            else -> {
                                response
                                    .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                                    .sendString(Mono.just("{}"))
                                    .then()
                            }
                        }
                    }
                }.bindNow()

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("taskpilot.gateway.core-origin") { "http://127.0.0.1:${stub.port()}" }
            registry.add("taskpilot.gateway.maximum-request-bytes") { REQUEST_LIMIT.toString() }
            registry.add("taskpilot.gateway.maximum-response-bytes") { RESPONSE_LIMIT.toString() }
            registry.add("taskpilot.gateway.maximum-header-bytes") { "4096" }
            registry.add("taskpilot.gateway.upstream-response-timeout") { "200ms" }
            registry.add("taskpilot.gateway.response-timeout") { "300ms" }
        }

        private fun query(uri: String): Map<String, String> =
            URI
                .create(uri)
                .rawQuery
                ?.split('&')
                ?.mapNotNull { part ->
                    val pieces = part.split('=', limit = 2)
                    pieces.firstOrNull()?.let { it to pieces.getOrElse(1) { "" } }
                }?.toMap()
                .orEmpty()
    }
}

private enum class RequestFraming {
    DECLARED,
    UNKNOWN_LENGTH,
    EXPLICIT_CHUNKED,
}

private data class ObservedRequest(
    val method: String,
    val uri: String,
    val headers: Map<String, String>,
    val body: String,
)
