package ai.taskpilot.coreapi.architecture

import com.tngtech.archunit.core.importer.ClassFileImporter
import com.tngtech.archunit.core.importer.ImportOption
import kotlin.test.Test
import kotlin.test.assertTrue

class CoreApiArchitectureTest {
    @Test
    fun `production code obeys technical boundaries`() {
        val classes =
            ClassFileImporter()
                .withImportOption(ImportOption.DoNotIncludeTests())
                .importPackages("ai.taskpilot.coreapi")
        val productionClasses = classes.toList()

        assertTrue(productionClasses.isNotEmpty(), "expected Core API production classes to be imported")
        assertTrue(
            productionClasses.any { it.name == "ai.taskpilot.coreapi.CoreApiArchitectureRoot" },
            "expected the stable Core API architecture root to be imported",
        )
        CoreApiArchitectureRules.rules.values.forEach { it.check(classes) }
    }
}
