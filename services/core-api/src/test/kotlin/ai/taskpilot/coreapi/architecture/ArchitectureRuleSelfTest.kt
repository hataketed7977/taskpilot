package ai.taskpilot.coreapi.architecture

import com.tngtech.archunit.core.importer.ClassFileImporter
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFailsWith

class ArchitectureRuleSelfTest {
    private val importer = ClassFileImporter()

    @Test
    fun `allowed fixtures satisfy every rule`() {
        val classes = importer.importPackages("ai.taskpilot.architecturefixtures.archunit.allowed")
        CoreApiArchitectureRules.rules.values.forEach { it.check(classes) }
    }

    @TestFactory
    fun `each forbidden case independently proves its exact rule condition`(): List<DynamicTest> =
        forbiddenCases.map { case ->
            DynamicTest.dynamicTest("${case.ruleId}/${case.caseId}") {
                val rule = requireNotNull(CoreApiArchitectureRules.rules[case.ruleId])
                val classes = importer.importPackages(*case.packages.toTypedArray())
                val failure =
                    assertFailsWith<AssertionError>("expected ${case.ruleId}/${case.caseId} violation") {
                        rule.check(classes)
                    }
                assertContains(failure.message.orEmpty(), "[${case.ruleId}]")
                assertContains(failure.message.orEmpty(), "Forbidden")
                assertContains(failure.message.orEmpty(), case.expectedSource)
                case.expectedTarget?.let { assertContains(failure.message.orEmpty(), it) }
            }
        }

    private data class ForbiddenCase(
        val ruleId: String,
        val caseId: String,
        val expectedSource: String,
        val expectedTarget: String? = null,
        val additionalPackages: List<String> = emptyList(),
    ) {
        val packages =
            listOf("ai.taskpilot.architecturefixtures.archunit.forbidden.${ruleId.replace('-', '_')}.$caseId") +
                additionalPackages
    }

    private companion object {
        val forbiddenCases =
            listOf(
                frameworkCase("mvc", "org.springframework.web.servlet.DispatcherServlet"),
                frameworkCase("security", "org.springframework.security.web.SecurityFilterChain"),
                frameworkCase("jakarta_persistence", "jakarta.persistence.EntityManager"),
                frameworkCase("spring_data", "org.springframework.data.repository.Repository"),
                frameworkCase("spring_jdbc", "org.springframework.jdbc.core.JdbcTemplate"),
                frameworkCase("jooq", "org.jooq.DSLContext"),
                frameworkCase(
                    "transport",
                    "ai.taskpilot.architecturefixtures.archunit.forbidden.model_framework_isolation" +
                        ".transport.transport.TransportDto",
                ),
                frameworkCase("provider", "com.vendor.provider.sdk.ProviderClient"),
                leakageCase("persistence_type", "PersistenceType"),
                leakageCase("provider_type", "ProviderType"),
                apiSurfaceCase("desktop_to_public", "DesktopEndpoint", "PublicDto"),
                apiSurfaceCase("public_to_desktop", "PublicEndpoint", "DesktopDto"),
                apiSurfaceCase("desktop_to_managed", "DesktopEndpoint", "ManagedDto"),
                apiSurfaceCase("managed_to_desktop", "ManagedEndpoint", "DesktopDto"),
                apiSurfaceCase("public_to_managed", "PublicEndpoint", "ManagedDto"),
                apiSurfaceCase("managed_to_public", "ManagedEndpoint", "PublicDto"),
                controllerCase("internal", "ProjectInternal"),
                controllerCase("repository", "ProjectRepository"),
                reverseDependencyCase("desktop", "ai.taskpilot.desktop.internal.DesktopInternal"),
                reverseDependencyCase("agent_runtime", "ai.taskpilot.agentruntime.internal.RuntimeInternal"),
                reverseDependencyCase("gateway", "ai.taskpilot.gateway.internal.GatewayInternal"),
                ForbiddenCase("shared-package-escape", "shared", "SharedEscape"),
                ForbiddenCase("shared-package-escape", "common", "CommonEscape"),
            )

        fun frameworkCase(
            caseId: String,
            target: String,
        ) = ForbiddenCase("model-framework-isolation", caseId, "ForbiddenModel", target)

        fun leakageCase(
            caseId: String,
            target: String,
        ) = ForbiddenCase("implementation-type-leakage", caseId, "Consumer", target)

        fun apiSurfaceCase(
            caseId: String,
            source: String,
            target: String,
        ) = ForbiddenCase("api-surface-isolation", caseId, source, target)

        fun controllerCase(
            caseId: String,
            target: String,
        ) = ForbiddenCase("controller-capability-isolation", caseId, "AccessController", target)

        fun reverseDependencyCase(
            caseId: String,
            target: String,
        ) = ForbiddenCase(
            "project-reverse-dependency",
            caseId,
            "ForbiddenCoreApiDependency",
            target,
            listOf(target.substringBeforeLast('.')),
        )
    }
}
