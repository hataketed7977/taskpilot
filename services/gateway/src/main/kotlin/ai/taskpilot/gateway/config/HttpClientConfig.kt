package ai.taskpilot.gateway.config

import io.netty.channel.ChannelOption
import org.springframework.cloud.gateway.config.HttpClientCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration(proxyBeanMethods = false)
class HttpClientConfig {
    @Bean
    fun gatewayHttpClientCustomizer(properties: GatewayProperties): HttpClientCustomizer =
        HttpClientCustomizer { client ->
            client
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, properties.connectTimeout.toMillis().toInt())
                .responseTimeout(properties.upstreamResponseTimeout)
        }
}
