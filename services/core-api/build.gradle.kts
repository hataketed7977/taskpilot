import java.util.jar.JarFile

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.detekt)
    alias(libs.plugins.ktlint)
    alias(libs.plugins.kover)
}

group = "ai.taskpilot"
version = "0.1.0"

java {
    toolchain {
        languageVersion =
            JavaLanguageVersion.of(
                libs.versions.java
                    .get()
                    .toInt(),
            )
    }
}

repositories {
    mavenCentral()
}

val architectureFixtures = sourceSets.create("architectureFixtures")
val moduleTest = sourceSets.create("moduleTest")
val integrationTest = sourceSets.create("integrationTest")

sourceSets.named("test") {
    compileClasspath += architectureFixtures.output
    runtimeClasspath += architectureFixtures.output
}

configurations[architectureFixtures.implementationConfigurationName].extendsFrom(configurations.testImplementation.get())
configurations[moduleTest.implementationConfigurationName].extendsFrom(configurations.testImplementation.get())
configurations[moduleTest.runtimeOnlyConfigurationName].extendsFrom(configurations.testRuntimeOnly.get())
configurations[integrationTest.implementationConfigurationName].extendsFrom(configurations.testImplementation.get())
configurations[integrationTest.runtimeOnlyConfigurationName].extendsFrom(configurations.testRuntimeOnly.get())

listOf(moduleTest, integrationTest).forEach { sourceSet ->
    sourceSet.compileClasspath += sourceSets.main.get().output
    sourceSet.runtimeClasspath += sourceSets.main.get().output
}

dependencies {
    implementation(platform(libs.spring.modulith.bom))
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("tools.jackson.module:jackson-module-kotlin")
    implementation(libs.icu4j)
    implementation(libs.bouncycastle)
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-mail")
    implementation(libs.springdoc.webmvc.ui)
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation(libs.flyway.postgresql)
    runtimeOnly(libs.postgresql)
    implementation("org.springframework.modulith:spring-modulith-starter-core")

    testImplementation(platform(libs.spring.modulith.bom))
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
    testImplementation("org.springframework.modulith:spring-modulith-starter-test")
    testImplementation(libs.archunit.junit5)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")

    add(integrationTest.implementationConfigurationName, platform(libs.testcontainers.bom))
    add(integrationTest.implementationConfigurationName, libs.testcontainers.postgresql)
    add(integrationTest.implementationConfigurationName, libs.postgresql)
    add(integrationTest.implementationConfigurationName, libs.flyway.core)
    add(integrationTest.implementationConfigurationName, libs.flyway.postgresql)
}

kotlin {
    compilerOptions {
        freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
        allWarningsAsErrors.set(true)
    }
}

ktlint {
    version.set(libs.versions.ktlint.engine)
}

detekt {
    buildUponDefaultConfig = true
    parallel = true
    config.setFrom(files("config/detekt.yml"))
    source.setFrom(
        files(
            "src/main/kotlin",
            "src/test/kotlin",
            "src/moduleTest/kotlin",
            "src/integrationTest/kotlin",
        ),
    )
}

// Detekt 1.23.8 is compiled against Kotlin 2.0.21. Spring dependency management
// otherwise upgrades Detekt's isolated tool classpath to the application's Kotlin version.
configurations.named("detekt") {
    resolutionStrategy.eachDependency {
        if (requested.group == "org.jetbrains.kotlin") {
            useVersion(
                libs.versions.detekt.kotlin
                    .get(),
            )
            because("Detekt must run with the Kotlin compiler version it was compiled against")
        }
    }
}

kover {
    currentProject {
        sources {
            includedSourceSets.add("main")
        }
    }
    reports {
        filters {
            excludes {
                classes(
                    "ai.taskpilot.coreapi.CoreApiArchitectureRoot",
                    "ai.taskpilot.coreapi.access.AccessModule",
                    "ai.taskpilot.coreapi.project.ProjectModule",
                    "ai.taskpilot.coreapi.automation.AutomationModule",
                    "ai.taskpilot.coreapi.agent.AgentModule",
                )
            }
        }
        total {
            xml {
                onCheck = true
            }
            html {
                onCheck = true
            }
            verify {
                rule("module-wide line coverage") {
                    bound {
                        minValue = 80
                        coverageUnits = kotlinx.kover.gradle.plugin.dsl.CoverageUnit.LINE
                    }
                }
                rule("module-wide branch coverage") {
                    bound {
                        minValue = 75
                        coverageUnits = kotlinx.kover.gradle.plugin.dsl.CoverageUnit.BRANCH
                    }
                }
            }
        }
    }
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

val moduleTestTask =
    tasks.register<Test>("moduleTest") {
        description = "Runs Spring module and application context tests."
        group = LifecycleBasePlugin.VERIFICATION_GROUP
        testClassesDirs = moduleTest.output.classesDirs
        classpath = moduleTest.runtimeClasspath
        shouldRunAfter(tasks.test)
    }

val integrationTestTask =
    tasks.register<Test>("integrationTest") {
        description = "Runs real-infrastructure integration tests."
        group = LifecycleBasePlugin.VERIFICATION_GROUP
        testClassesDirs = integrationTest.output.classesDirs
        classpath = integrationTest.runtimeClasspath
        failOnNoDiscoveredTests = true
        shouldRunAfter(moduleTestTask)
    }

val verifyBuildContract =
    tasks.register("verifyBuildContract") {
        group = LifecycleBasePlugin.VERIFICATION_GROUP
        description = "Verifies Core API source-set, dependency, task, and runtime artifact boundaries."
        dependsOn(tasks.named("bootJar"))

        doLast {
            val requiredSourceSets = setOf("main", "test", "architectureFixtures", "moduleTest", "integrationTest")
            check(sourceSets.names.containsAll(requiredSourceSets)) {
                "Missing source sets: ${requiredSourceSets - sourceSets.names}"
            }
            val requiredTasks =
                setOf(
                    "test",
                    "moduleTest",
                    "integrationTest",
                    "verifyBuildContract",
                    "ktlintCheck",
                    "detekt",
                    "koverXmlReport",
                    "koverHtmlReport",
                    "koverVerify",
                    "qualityCheck",
                )
            check(tasks.names.containsAll(requiredTasks)) { "Missing test/build tasks: ${requiredTasks - tasks.names}" }
            check("qualityCheck" !in rootProject.tasks.names) {
                "A root qualityCheck is forbidden; use :services:core-api:qualityCheck"
            }

            fun transitiveDependenciesOf(task: Task): Set<String> {
                val visited = mutableSetOf<Task>()

                fun visit(current: Task) {
                    current.taskDependencies.getDependencies(current).forEach { dependency ->
                        if (visited.add(dependency)) {
                            visit(dependency)
                        }
                    }
                }

                visit(task)
                return visited.map { it.name }.toSet()
            }

            val fastTest = tasks.named<Test>("test").get()
            val fastDependencies = transitiveDependenciesOf(fastTest)
            check("moduleTest" !in fastDependencies && "integrationTest" !in fastDependencies) {
                "test must not depend on moduleTest or integrationTest"
            }
            val fastClasspath = fastTest.classpath.files.joinToString("\n") { it.name.lowercase() }
            check("testcontainers" !in fastClasspath) { "test runtime classpath must not contain Testcontainers" }

            val requiredTestFiles =
                setOf(
                    "CoreApiModularityTest.kt",
                    "ModulithViolationFixtureTest.kt",
                    "CoreApiArchitectureTest.kt",
                    "ArchitectureRuleSelfTest.kt",
                    "CoreApiArchitectureRules.kt",
                )
            val testFiles = fileTree("src/test").files.map { it.name }.toSet()
            check(testFiles.containsAll(requiredTestFiles)) {
                "src/test is missing required foundation tests: ${requiredTestFiles - testFiles}"
            }
            val requiredModuleTests =
                setOf(
                    "CapabilityModuleTests.kt",
                    "CoreApiApplicationSmokeTest.kt",
                    "CoreApiHealthHttpTest.kt",
                )
            val moduleTestFiles = fileTree("src/moduleTest").files.map { it.name }.toSet()
            check(moduleTestFiles.containsAll(requiredModuleTests)) {
                "src/moduleTest is missing required foundation tests: ${requiredModuleTests - moduleTestFiles}"
            }
            val integrationTestFiles =
                fileTree("src/integrationTest/kotlin")
                    .matching { include("**/*Test.kt", "**/*Test.java") }
                    .files
                    .map { it.relativeTo(file("src/integrationTest/kotlin")).invariantSeparatorsPath }
                    .toSet()
            val requiredIntegrationTestFiles =
                setOf("ai/taskpilot/coreapi/PostgreSqlFoundationIntegrationTest.kt")
            check(integrationTestFiles.containsAll(requiredIntegrationTestFiles)) {
                "integrationTest is missing required real-infrastructure tests: " +
                    "${requiredIntegrationTestFiles - integrationTestFiles}"
            }

            val detektSources =
                tasks
                    .named<io.gitlab.arturbosch.detekt.Detekt>("detekt")
                    .get()
                    .source.files
                    .map { it.canonicalFile }
            val requiredDetektSourceRoots =
                listOf(
                    file("src/main/kotlin").canonicalFile,
                    file("src/test/kotlin").canonicalFile,
                    file("src/moduleTest/kotlin").canonicalFile,
                    file("src/integrationTest/kotlin").canonicalFile,
                )
            check(requiredDetektSourceRoots.all { required -> detektSources.any { it.startsWith(required) } }) {
                "Detekt does not cover every Kotlin source set: " +
                    requiredDetektSourceRoots.filterNot { required -> detektSources.any { it.startsWith(required) } }
            }

            val prohibitedCoordinates =
                setOf(
                    "com.h2database:h2",
                    "org.springframework.boot:spring-boot-starter-data-jpa",
                    "org.springframework.boot:spring-boot-starter-data-jdbc",
                    "org.springframework.boot:spring-boot-starter-data-redis",
                    "org.springframework.kafka:spring-kafka",
                    "org.apache.kafka:kafka-clients",
                    "org.springframework.amqp:spring-rabbit",
                    "com.rabbitmq:amqp-client",
                    "io.lettuce:lettuce-core",
                )
            val runtimeComponents =
                configurations.runtimeClasspath
                    .get()
                    .incoming.resolutionResult.allComponents
                    .mapNotNull { component ->
                        component.moduleVersion?.let { "${it.group}:${it.name}" }
                    }.toSet()
            check(runtimeComponents.none(prohibitedCoordinates::contains)) {
                "Prohibited production dependency found: ${runtimeComponents.intersect(prohibitedCoordinates)}"
            }

            val runtimeJar =
                tasks
                    .named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar")
                    .get()
                    .archiveFile
                    .get()
                    .asFile
            JarFile(runtimeJar).use { jar ->
                val entries =
                    jar
                        .entries()
                        .asSequence()
                        .map { it.name }
                        .toSet()
                check(entries.contains("BOOT-INF/classes/ai/taskpilot/coreapi/CoreApiApplication.class")) {
                    "Executable runtime JAR does not contain the Core API application"
                }
                check(entries.any { it.startsWith("BOOT-INF/lib/") }) {
                    "Executable runtime JAR does not contain runtime dependencies"
                }
                check(jar.manifest.mainAttributes.getValue("Start-Class") == "ai.taskpilot.coreapi.CoreApiApplicationKt") {
                    "Executable runtime JAR has an unexpected Start-Class"
                }
                check(entries.contains("BOOT-INF/classes/db/migration/V1__create_access_identity.sql")) {
                    "Executable runtime JAR does not contain the production access-identity migration"
                }
                check(entries.contains("BOOT-INF/classes/db/migration/V2__create_verification_security.sql")) {
                    "Executable runtime JAR does not contain the production verification-security migration"
                }
                check(entries.contains("BOOT-INF/classes/db/migration/V4__create_workspaces.sql")) {
                    "Executable runtime JAR does not contain the production workspace migration"
                }
                check(entries.contains("BOOT-INF/classes/db/migration/V5__create_projects.sql")) {
                    "Executable runtime JAR does not contain the production project migration"
                }
                check(
                    entries.none { entry ->
                        entry.contains("Test.class") ||
                            entry.contains("architecturefixtures", ignoreCase = true) ||
                            entry.contains("db/integration", ignoreCase = true) ||
                            entry.endsWith("V1__integration_probe.sql", ignoreCase = true)
                    },
                ) { "Executable runtime JAR contains test, fixture, or integration-only content" }
            }

            val versionCatalog = rootProject.file("gradle/libs.versions.toml").readText()
            val forbiddenVersionTokens = listOf("SNAP" + "SHOT", "latest.release", "latest.integration")
            check(forbiddenVersionTokens.none(versionCatalog::contains)) {
                "Version catalog uses a dynamic or snapshot version"
            }
            check(!Regex("""version\s*=\s*"[^"]*\+[^"]*"""").containsMatchIn(versionCatalog)) {
                "Version catalog uses a dynamic '+' version"
            }
        }
    }

val qualityCheck =
    tasks.register("qualityCheck") {
        group = LifecycleBasePlugin.VERIFICATION_GROUP
        description = "Runs the complete Core API compile, static-analysis, test, contract, and coverage gate."
        dependsOn(
            tasks.compileKotlin,
            tasks.named("ktlintCheck"),
            tasks.named("detekt"),
            tasks.test,
            moduleTestTask,
            integrationTestTask,
            verifyBuildContract,
            tasks.named("koverXmlReport"),
            tasks.named("koverHtmlReport"),
            tasks.named("koverVerify"),
        )
    }

verifyBuildContract.configure {
    doLast {
        val requiredQualityDependencies =
            setOf(
                "compileKotlin",
                "ktlintCheck",
                "detekt",
                "test",
                "moduleTest",
                "integrationTest",
                "verifyBuildContract",
                "koverXmlReport",
                "koverHtmlReport",
                "koverVerify",
            )
        val actualQualityDependencies =
            qualityCheck
                .get()
                .taskDependencies
                .getDependencies(qualityCheck.get())
                .map { it.name }
                .toSet()
        check(actualQualityDependencies.containsAll(requiredQualityDependencies)) {
            "qualityCheck is missing direct dependencies: ${requiredQualityDependencies - actualQualityDependencies}"
        }

        listOf("koverXmlReport", "koverHtmlReport", "koverVerify").forEach { reportTaskName ->
            val reportTask = tasks.named(reportTaskName).get()
            val visited = mutableSetOf<Task>()

            fun visit(current: Task) {
                current.taskDependencies.getDependencies(current).forEach { dependency ->
                    if (visited.add(dependency)) {
                        visit(dependency)
                    }
                }
            }

            visit(reportTask)
            val dependencyNames = visited.map { it.name }.toSet()
            val missingTestLayers = setOf("test", "moduleTest", "integrationTest") - dependencyNames
            check(missingTestLayers.isEmpty()) {
                "$reportTaskName does not aggregate test layers: $missingTestLayers"
            }
        }
    }
}
