package ai.taskpilot.coreapi.architecture

import org.springframework.modulith.core.ApplicationModules
import kotlin.test.Test
import kotlin.test.assertEquals

class CoreApiModularityTest {
    @Test
    fun `production module graph contains exactly the runnable capabilities`() {
        val modules = ApplicationModules.of("ai.taskpilot.coreapi")
        val moduleNames = modules.map { it.identifier.toString() }.toSet()
        assertEquals(setOf("access", "automation", "agent"), moduleNames)
        modules.verify()
    }
}
