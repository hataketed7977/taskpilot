package ai.taskpilot.coreapi.architecture

import com.tngtech.archunit.core.importer.ClassFileImporter
import com.tngtech.archunit.core.importer.ImportOption
import kotlin.test.Test

class CoreApiArchitectureTest {
    @Test
    fun `production code obeys technical boundaries`() {
        val classes =
            ClassFileImporter()
                .withImportOption(ImportOption.DoNotIncludeTests())
                .importPackages("ai.taskpilot.coreapi")
        CoreApiArchitectureRules.rules.values.forEach { it.check(classes) }
    }
}
