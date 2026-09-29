package ai.taskpilot.coreapi.architecture

import com.tngtech.archunit.core.domain.JavaClass
import com.tngtech.archunit.lang.ArchCondition
import com.tngtech.archunit.lang.ArchRule
import com.tngtech.archunit.lang.ConditionEvents
import com.tngtech.archunit.lang.SimpleConditionEvent
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes

internal object CoreApiArchitectureRules {
    private val capabilities = setOf("access", "project", "automation", "agent")
    private val apiSurfaceSegments =
        mapOf(
            "desktop" to setOf("desktopapi"),
            "public" to setOf("publicapi"),
            "managed-execution" to setOf("managedapi"),
        )
    private val persistencePackagePrefixes =
        setOf(
            "jakarta.persistence",
            "org.springframework.data",
            "org.springframework.jdbc",
            "org.jooq",
        )

    val rules: Map<String, ArchRule> =
        linkedMapOf(
            "model-framework-isolation" to
                dependencyRule("model-framework-isolation") { source, target ->
                    source.inSegment("model") &&
                        target.packageName.let { targetPackage ->
                            targetPackage.startsWithAny(
                                "org.springframework.web",
                                "org.springframework.security",
                            ) ||
                                persistencePackagePrefixes.any(targetPackage::startsWith) ||
                                targetPackage.inAnySegment("transport", "provider")
                        }
                },
            "implementation-type-leakage" to
                dependencyRule("implementation-type-leakage") { source, target ->
                    !source.packageName.inAnySegment("infrastructure", "persistence", "provider") &&
                        target.packageName.inAnySegment("infrastructure", "persistence", "provider")
                },
            "api-surface-isolation" to
                dependencyRule("api-surface-isolation") { source, target ->
                    val sourceSurface = source.packageName.apiSurface()
                    val targetSurface = target.packageName.apiSurface()
                    sourceSurface != null && targetSurface != null && sourceSurface != targetSurface
                },
            "controller-capability-isolation" to
                dependencyRule("controller-capability-isolation") { source, target ->
                    val sourceCapability = source.packageName.firstSegmentFrom(capabilities)
                    val targetCapability = target.packageName.firstSegmentFrom(capabilities)
                    source.packageName.inAnySegment("controller", "transport") &&
                        target.packageName.inAnySegment("internal", "repository") &&
                        sourceCapability != null &&
                        targetCapability != null &&
                        sourceCapability != targetCapability
                },
            "project-reverse-dependency" to
                dependencyRule("project-reverse-dependency") { source, target ->
                    source.packageName.inSegment("coreapi") &&
                        target.packageName.startsWithAny(
                            "ai.taskpilot.desktop",
                            "ai.taskpilot.agentruntime",
                            "ai.taskpilot.gateway",
                        )
                },
            "shared-package-escape" to
                classes()
                    .should(notResideInEscapePackage())
                    .because("[shared-package-escape] shared/common packages cannot bypass capability ownership"),
        )

    private fun dependencyRule(
        id: String,
        forbidden: (JavaClass, JavaClass) -> Boolean,
    ): ArchRule =
        classes().should(
            object : ArchCondition<JavaClass>("not create forbidden dependency [$id]") {
                override fun check(
                    item: JavaClass,
                    events: ConditionEvents,
                ) {
                    item.directDependenciesFromSelf
                        .filter { forbidden(item, it.targetClass) }
                        .forEach { dependency ->
                            events.add(
                                SimpleConditionEvent.violated(
                                    item,
                                    "[$id] Forbidden dependency ${dependency.originClass.name} -> " +
                                        dependency.targetClass.name,
                                ),
                            )
                        }
                }
            },
        )

    private fun notResideInEscapePackage() =
        object : ArchCondition<JavaClass>("not reside in a shared/common escape package") {
            override fun check(
                item: JavaClass,
                events: ConditionEvents,
            ) {
                if (item.packageName.inAnySegment("shared", "common")) {
                    events.add(SimpleConditionEvent.violated(item, "[shared-package-escape] Forbidden ${item.name}"))
                }
            }
        }

    private fun JavaClass.inSegment(segment: String) = packageName.inSegment(segment)

    private fun String.inSegment(segment: String) = split('.').contains(segment)

    private fun String.inAnySegment(vararg segments: String) = segments.any { segment -> inSegment(segment) }

    private fun String.firstSegmentFrom(candidates: Set<String>) = split('.').firstOrNull(candidates::contains)

    private fun String.apiSurface(): String? =
        apiSurfaceSegments.entries.firstOrNull { (_, segments) -> segments.any { segment -> inSegment(segment) } }?.key

    private fun String.startsWithAny(vararg prefixes: String) = prefixes.any(::startsWith)
}
