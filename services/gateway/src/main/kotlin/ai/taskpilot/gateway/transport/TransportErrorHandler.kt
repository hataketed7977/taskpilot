package ai.taskpilot.gateway.transport

import org.springframework.boot.webflux.error.ErrorWebExceptionHandler
import org.springframework.core.annotation.Order
import org.springframework.core.io.buffer.DataBuffer
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.server.ServerWebExchange
import reactor.core.publisher.Mono

@Component
@Order(-2)
class TransportErrorHandler : ErrorWebExceptionHandler {
    override fun handle(
        exchange: ServerWebExchange,
        failure: Throwable,
    ): Mono<Void> {
        if (exchange.response.isCommitted) return Mono.error(failure)
        val correlation =
            exchange.response.headers.getFirst(TransportPolicyFilter.CORRELATION_HEADER)
                ?: (failure as? TransportException)?.correlationId
                ?: "unavailable"
        val (status, code) =
            when (failure) {
                is TransportException -> failure.status to failure.code
                is ResponseStatusException -> failure.statusCode to "GATEWAY_ROUTE_NOT_FOUND"
                else -> HttpStatus.SERVICE_UNAVAILABLE to "GATEWAY_UPSTREAM_UNAVAILABLE"
            }
        val json =
            """{"type":"https://taskpilot.ai/problems/gateway-transport",""" +
                """"title":"Gateway transport failure","status":${status.value()},""" +
                """"code":"$code","correlationId":"$correlation"}"""
        val bytes = json.toByteArray()
        exchange.response.statusCode = status
        exchange.response.headers.clear()
        exchange.response.headers.contentType = MediaType.APPLICATION_PROBLEM_JSON
        exchange.response.headers.contentLength = bytes.size.toLong()
        exchange.response.headers[TransportPolicyFilter.CORRELATION_HEADER] = correlation
        val buffer: DataBuffer = exchange.response.bufferFactory().wrap(bytes)
        return exchange.response.writeWith(Mono.just(buffer))
    }
}
