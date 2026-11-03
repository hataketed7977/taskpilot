package ai.taskpilot.gateway.config

import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.validation.annotation.Validated
import java.net.URI
import java.time.Duration

@Validated
@ConfigurationProperties("taskpilot.gateway")
data class GatewayProperties(
    @field:NotBlank val coreOrigin: String = "http://127.0.0.1:45432",
    @field:Min(1) @field:Max(16_777_216) val maximumRequestBytes: Int = 1_048_576,
    @field:Min(1) @field:Max(16_777_216) val maximumResponseBytes: Int = 4_194_304,
    @field:Min(1) @field:Max(1_048_576) val maximumHeaderBytes: Int = 16_384,
    val connectTimeout: Duration = Duration.ofSeconds(2),
    val upstreamResponseTimeout: Duration = Duration.ofSeconds(8),
    val responseTimeout: Duration = Duration.ofSeconds(10),
) {
    init {
        require(!connectTimeout.isZero && !connectTimeout.isNegative) { "Connect timeout must be positive" }
        require(connectTimeout.toMillis() <= Int.MAX_VALUE) {
            "Connect timeout must fit the Netty millisecond range"
        }
        require(!upstreamResponseTimeout.isZero && !upstreamResponseTimeout.isNegative) {
            "Upstream response timeout must be positive"
        }
        require(!responseTimeout.isZero && !responseTimeout.isNegative) { "Response timeout must be positive" }
    }

    fun validatedCoreOrigin(): URI {
        val uri = URI.create(coreOrigin)
        require(uri.scheme == "http" || uri.scheme == "https") { "Core origin must use HTTP or HTTPS" }
        require(uri.userInfo == null) { "Core origin must not contain user information" }
        val hasOnlyOriginComponents =
            uri.rawQuery == null &&
                uri.rawFragment == null &&
                (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")
        require(hasOnlyOriginComponents) { "Core origin must not contain path, query, or fragment" }
        require(uri.host != null) { "Core origin must include a host" }
        return URI(uri.scheme, null, uri.host, uri.port, null, null, null)
    }
}
