package ai.taskpilot.coreapi.architecture

import com.tngtech.archunit.core.importer.ImportOption
import org.springframework.modulith.core.ApplicationModules
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ModulithViolationFixtureTest {
    @Test
    fun `valid fixture has no module violation`() {
        val modules = fixtureModules("ai.taskpilot.architecturefixtures.modulith.valid")
        assertExpectedModulesDiscovered(modules)

        val violations = modules.detectViolations()
        assertFalse(violations.hasViolations())
    }

    @Test
    fun `invalid fixture exposes cross-module internal access`() {
        val modules = fixtureModules("ai.taskpilot.architecturefixtures.modulith.invalid")
        assertExpectedModulesDiscovered(modules)

        val violations = modules.detectViolations()
        assertTrue(violations.hasViolations(), "expected internal-access violation")
        assertTrue(violations.message.contains("alpha") && violations.message.contains("beta"), violations.message)
    }

    private fun fixtureModules(basePackage: String) = ApplicationModules.of(basePackage, ImportOption { true })

    private fun assertExpectedModulesDiscovered(modules: ApplicationModules) {
        assertTrue(modules.getModuleByName("alpha").isPresent, "expected alpha module to be discovered")
        assertTrue(modules.getModuleByName("beta").isPresent, "expected beta module to be discovered")
    }
}
