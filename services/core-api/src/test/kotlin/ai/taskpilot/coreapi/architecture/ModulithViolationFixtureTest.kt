package ai.taskpilot.coreapi.architecture

import org.springframework.modulith.core.ApplicationModules
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ModulithViolationFixtureTest {
    @Test
    fun `valid fixture has no module violation`() {
        val violations = ApplicationModules.of("ai.taskpilot.architecturefixtures.modulith.valid").detectViolations()
        assertFalse(violations.hasViolations())
    }

    @Test
    fun `invalid fixture exposes cross-module internal access`() {
        val violations = ApplicationModules.of("ai.taskpilot.architecturefixtures.modulith.invalid").detectViolations()
        assertTrue(violations.hasViolations(), "expected internal-access violation")
        assertTrue(violations.message.contains("alpha") && violations.message.contains("beta"), violations.message)
    }
}
