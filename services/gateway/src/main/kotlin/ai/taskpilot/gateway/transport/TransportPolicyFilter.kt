package ai.taskpilot.gateway.transport

import ai.taskpilot.gateway.config.GatewayProperties
import ai.taskpilot.gateway.route.RouteCatalog
import io.netty.handler.timeout.ReadTimeoutException
import org.reactivestreams.Publisher
import org.springframework.core.Ordered
import org.springframework.core.io.buffer.DataBuffer
import org.springframework.core.io.buffer.DataBufferLimitException
import org.springframework.core.io.buffer.DataBufferUtils
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.server.reactive.ServerHttpRequest
import org.springframework.http.server.reactive.ServerHttpRequestDecorator
import org.springframework.http.server.reactive.ServerHttpResponse
import org.springframework.http.server.reactive.ServerHttpResponseDecorator
import org.springframework.stereotype.Component
import org.springframework.web.server.ServerWebExchange
import org.springframework.web.server.WebFilter
import org.springframework.web.server.WebFilterChain
import reactor.core.publisher.Flux
import reactor.core.publisher.Mono
import java.net.ConnectException
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.TimeoutException

@Component
@Suppress("TooManyFunctions") // Cohesive request and response transport boundary.
class TransportPolicyFilter(
    private val properties: GatewayProperties,
    private val routeCatalog: RouteCatalog,
) : WebFilter,
    Ordered {
    override fun getOrder(): Int = Ordered.HIGHEST_PRECEDENCE + 20

    @Suppress("ReturnCount") // Fail-fast checks must reject before routing.
    override fun filter(exchange: ServerWebExchange, chain: WebFilterChain): Mono<Void> {
        val correlationId =
            validatedCorrelationId(exchange.request.headers.getOrEmpty(CORRELATION_HEADER))
                ?: UUID.randomUUID().toString()
        exchange.response.headers[CORRELATION_HEADER] = correlationId

        val requestPath = exchange.request.path.value()
        if (requestPath !in HEALTH_PATHS && !routeCatalog.contains(exchange.request.method, requestPath)) {
            return Mono.error(TransportException.routeNotFound(correlationId))
        }

        if (headerBytes(exchange.request.headers) > properties.maximumHeaderBytes) {
            return Mono.error(TransportException.requestHeadersTooLarge(correlationId))
        }
        val sanitized =
            exchange.request
                .mutate()
                .headers { headers -> sanitize(headers, correlationId) }
                .build()
        if (sanitized.headers.contentLength > properties.maximumRequestBytes) {
            return Mono.error(TransportException.payloadTooLarge(correlationId))
        }

        return boundedRequest(sanitized, correlationId).flatMap { request ->
            val response = boundedResponse(exchange.response, correlationId)
            chain
                .filter(
                    exchange
                        .mutate()
                        .request(request)
                        .response(response)
                        .build(),
                ).timeout(properties.responseTimeout)
                .onErrorMap(::isTimeout) { TransportException.upstreamTimeout(correlationId) }
                .onErrorMap(::isConnectionFailure) { TransportException.upstreamUnavailable(correlationId) }
        }
    }

    private fun boundedRequest(
        request: ServerHttpRequest,
        correlationId: String,
    ): Mono<ServerHttpRequest> {
        if (request.headers.contentLength == 0L) return Mono.just(request)
        return DataBufferUtils
            .join(request.body, properties.maximumRequestBytes)
            .map { joined ->
                val bytes = ByteArray(joined.readableByteCount())
                joined.read(bytes)
                DataBufferUtils.release(joined)
                decoratedRequest(request, bytes)
            }.switchIfEmpty(Mono.fromSupplier { decoratedRequest(request, ByteArray(0)) })
            .onErrorMap(DataBufferLimitException::class.java) {
                TransportException.payloadTooLarge(correlationId)
            }
    }

    private fun decoratedRequest(
        request: ServerHttpRequest,
        bytes: ByteArray,
    ): ServerHttpRequest =
        object : ServerHttpRequestDecorator(request) {
            override fun getHeaders(): HttpHeaders =
                HttpHeaders(super.getHeaders()).also {
                    it.contentLength = bytes.size.toLong()
                    it.remove(HttpHeaders.TRANSFER_ENCODING)
                }

            override fun getBody(): Flux<DataBuffer> =
                if (bytes.isEmpty()) {
                    Flux.empty()
                } else {
                    Flux.defer { Flux.just(bufferFactory().wrap(bytes)) }
                }

            private fun bufferFactory() = org.springframework.core.io.buffer.DefaultDataBufferFactory.sharedInstance
        }

    private fun boundedResponse(
        response: ServerHttpResponse,
        correlationId: String,
    ): ServerHttpResponse =
        object : ServerHttpResponseDecorator(response) {
            @Suppress("ReturnCount") // Header and declared-body limits must fail before response commit.
            override fun writeWith(body: Publisher<out DataBuffer>): Mono<Void> {
                if (headerBytes(headers) > properties.maximumHeaderBytes) {
                    return Mono.error(TransportException.responseHeadersTooLarge(correlationId))
                }
                sanitizeResponse(headers, correlationId)
                if (headers.contentLength > properties.maximumResponseBytes) {
                    return Mono.error(TransportException.responseTooLarge(correlationId))
                }
                return DataBufferUtils
                    .join(Flux.from(body), properties.maximumResponseBytes)
                    .flatMap { joined ->
                        val bytes = ByteArray(joined.readableByteCount())
                        joined.read(bytes)
                        DataBufferUtils.release(joined)
                        headers.contentLength = bytes.size.toLong()
                        super.writeWith(Mono.just(bufferFactory().wrap(bytes)))
                    }.switchIfEmpty(super.writeWith(Flux.empty()))
                    .onErrorMap(DataBufferLimitException::class.java) {
                        TransportException.responseTooLarge(correlationId)
                    }
            }

            override fun writeAndFlushWith(body: Publisher<out Publisher<out DataBuffer>>): Mono<Void> =
                writeWith(Flux.from(body).concatMap { Flux.from(it) })

            override fun setComplete(): Mono<Void> {
                if (headerBytes(headers) > properties.maximumHeaderBytes) {
                    return Mono.error(TransportException.responseHeadersTooLarge(correlationId))
                }
                sanitizeResponse(headers, correlationId)
                return super.setComplete()
            }
        }

    private fun sanitize(
        headers: HttpHeaders,
        correlationId: String,
    ) {
        val connectionHeaders =
            headers
                .getOrEmpty(HttpHeaders.CONNECTION)
                .flatMap { value -> value.split(',') }
                .map(String::trim)
                .filter(String::isNotEmpty)
        val names = headers.headerSet().map { it.key }
        names
            .filter { name -> name.lowercase() !in ALLOWED_REQUEST_HEADERS || isUntrusted(name) }
            .plus(connectionHeaders)
            .forEach(headers::remove)
        headers[CORRELATION_HEADER] = correlationId
    }

    private fun sanitizeResponse(
        headers: HttpHeaders,
        correlationId: String,
    ) {
        val connectionHeaders =
            headers
                .getOrEmpty(HttpHeaders.CONNECTION)
                .flatMap { value -> value.split(',') }
                .map(String::trim)
                .filter(String::isNotEmpty)
        headers
            .headerSet()
            .map { it.key }
            .filter { name ->
                val normalized = name.lowercase()
                normalized == HttpHeaders.SET_COOKIE.lowercase() ||
                    normalized == HttpHeaders.COOKIE.lowercase() ||
                    isUntrusted(name)
            }.plus(connectionHeaders)
            .forEach(headers::remove)
        headers[CORRELATION_HEADER] = correlationId
    }

    private fun isUntrusted(name: String): Boolean {
        val normalized = name.lowercase()
        return normalized in HOP_BY_HOP ||
            normalized == "forwarded" ||
            normalized.startsWith("x-forwarded-") ||
            normalized == "x-real-ip" ||
            normalized.startsWith("x-original-") ||
            normalized.startsWith("x-rewrite-") ||
            normalized.startsWith("proxy-") ||
            TRUSTED_CONTEXT.any(normalized::contains)
    }

    private fun headerBytes(headers: HttpHeaders): Int =
        headers.headerSet().sumOf { header ->
            header.key.toByteArray(StandardCharsets.UTF_8).size +
                header.value.sumOf { value -> value.toByteArray(StandardCharsets.UTF_8).size } +
                HEADER_FRAMING_BYTES
        }

    private fun validatedCorrelationId(values: List<String>): String? =
        values
            .singleOrNull()
            ?.takeIf(CORRELATION_PATTERN::matches)

    private fun isTimeout(failure: Throwable): Boolean =
        when (failure) {
            is TimeoutException, is ReadTimeoutException -> true
            else -> false
        }

    private fun isConnectionFailure(failure: Throwable): Boolean =
        generateSequence(failure) { current -> current.cause }
            .any { current -> current is ConnectException }

    companion object {
        const val CORRELATION_HEADER = "X-Correlation-Id"
        private const val HEADER_FRAMING_BYTES = 4
        private val HEALTH_PATHS = setOf("/actuator/health/liveness", "/actuator/health/readiness")
        private val CORRELATION_PATTERN = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
        private val ALLOWED_REQUEST_HEADERS =
            setOf(
                "accept",
                "accept-language",
                "authorization",
                "content-length",
                "content-type",
                "host",
                "idempotency-key",
                "user-agent",
                CORRELATION_HEADER.lowercase(),
            )
        private val HOP_BY_HOP =
            setOf(
                "connection",
                "keep-alive",
                "transfer-encoding",
                "te",
                "trailer",
                "upgrade",
                "proxy-authenticate",
                "proxy-authorization",
            )
        private val TRUSTED_CONTEXT =
            setOf(
                "principal",
                "user-id",
                "workspace",
                "project",
                "role",
                "tenant",
                "internal-origin",
                "internal-identity",
            )
    }
}
