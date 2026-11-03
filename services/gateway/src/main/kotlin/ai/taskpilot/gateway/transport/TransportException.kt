package ai.taskpilot.gateway.transport

import org.springframework.http.HttpStatus

class TransportException(
    val status: HttpStatus,
    val code: String,
    val correlationId: String,
) : RuntimeException(code) {
    companion object {
        fun routeNotFound(correlationId: String) =
            TransportException(
                HttpStatus.NOT_FOUND,
                "GATEWAY_ROUTE_NOT_FOUND",
                correlationId,
            )

        fun payloadTooLarge(correlationId: String) =
            TransportException(HttpStatus.PAYLOAD_TOO_LARGE, "GATEWAY_REQUEST_TOO_LARGE", correlationId)

        fun requestHeadersTooLarge(correlationId: String) =
            TransportException(
                HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE,
                "GATEWAY_REQUEST_HEADERS_TOO_LARGE",
                correlationId,
            )

        fun responseHeadersTooLarge(correlationId: String) =
            TransportException(HttpStatus.BAD_GATEWAY, "GATEWAY_RESPONSE_HEADERS_TOO_LARGE", correlationId)

        fun responseTooLarge(correlationId: String) =
            TransportException(HttpStatus.BAD_GATEWAY, "GATEWAY_RESPONSE_TOO_LARGE", correlationId)

        fun upstreamTimeout(correlationId: String) =
            TransportException(HttpStatus.GATEWAY_TIMEOUT, "GATEWAY_UPSTREAM_TIMEOUT", correlationId)

        fun upstreamUnavailable(correlationId: String) =
            TransportException(HttpStatus.SERVICE_UNAVAILABLE, "GATEWAY_UPSTREAM_UNAVAILABLE", correlationId)
    }
}
