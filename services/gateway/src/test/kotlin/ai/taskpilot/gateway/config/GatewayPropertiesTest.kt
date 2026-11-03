package ai.taskpilot.gateway.config

import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class GatewayPropertiesTest {
    @Test
    fun `core origin accepts only a bare HTTP origin`() {
        assertEquals("http://127.0.0.1:45432", GatewayProperties().validatedCoreOrigin().toString())
        listOf(
            "ftp://127.0.0.1:45432",
            "http://user@127.0.0.1:45432",
            "http://127.0.0.1:45432/internal",
            "http://127.0.0.1:45432?secret=value",
            "http://127.0.0.1:45432#fragment",
        ).forEach { invalid ->
            assertFailsWith<IllegalArgumentException> {
                GatewayProperties(coreOrigin = invalid).validatedCoreOrigin()
            }
        }
    }

    @Test
    fun `timeouts must be positive and Netty connect timeout must fit milliseconds`() {
        assertFailsWith<IllegalArgumentException> { GatewayProperties(connectTimeout = Duration.ZERO) }
        assertFailsWith<IllegalArgumentException> { GatewayProperties(upstreamResponseTimeout = Duration.ZERO) }
        assertFailsWith<IllegalArgumentException> { GatewayProperties(responseTimeout = Duration.ofSeconds(-1)) }
        assertFailsWith<IllegalArgumentException> { GatewayProperties(connectTimeout = Duration.ofDays(30)) }
    }
}
