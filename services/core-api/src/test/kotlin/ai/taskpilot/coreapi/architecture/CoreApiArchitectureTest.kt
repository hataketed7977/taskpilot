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
        assertTrue(
            productionClasses.any { source ->
                source.directDependenciesFromSelf.any { dependency ->
                    dependency.targetClass.packageName.startsWith("ai.taskpilot.contract.generated")
                }
            },
            "expected production HTTP adapters to depend on generated transport types",
        )
        CoreApiArchitectureRules.rules.values.forEach { it.check(classes) }
    }
}
