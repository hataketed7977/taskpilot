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

val canonicalOpenApi =
    configurations.create("canonicalOpenApi") {
        isCanBeConsumed = false
        isCanBeResolved = true
        attributes {
            attribute(Category.CATEGORY_ATTRIBUTE, objects.named(Category.DOCUMENTATION))
            attribute(Usage.USAGE_ATTRIBUTE, objects.named("taskpilot-canonical-openapi"))
        }
    }

dependencies {
    implementation(project(":contracts:canonical-api")) { isTransitive = false }
    canonicalOpenApi(project(path = ":contracts:canonical-api", configuration = "canonicalOpenApiElements"))
    implementation(platform(libs.spring.modulith.bom))
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("tools.jackson.module:jackson-module-kotlin")
    implementation("org.yaml:snakeyaml")
    implementation(libs.icu4j)
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation(libs.springdoc.webmvc.ui)
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation(libs.flyway.postgresql)
    runtimeOnly(libs.postgresql)
    implementation("org.springframework.modulith:spring-modulith-starter-core")

    testImplementation(platform(libs.spring.modulith.bom))
    testImplementation(platform(libs.testcontainers.bom))
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
    testImplementation("org.springframework.modulith:spring-modulith-starter-test")
    testImplementation(libs.archunit.junit5)
    testImplementation(project(":services:gateway")) { isTransitive = false }
    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.postgresql)
    testImplementation(libs.flyway.core)
    testImplementation(libs.flyway.postgresql)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
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
                    "ai.taskpilot.coreapi.workspace.WorkspaceModule",
                    "ai.taskpilot.coreapi.project.ProjectModule",
                    "ai.taskpilot.coreapi.onboarding.OnboardingModule",
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

tasks.processResources {
    from(canonicalOpenApi) {
        into("canonical-api")
        rename { "openapi.yaml" }
    }
}

tasks.compileKotlin {
    dependsOn(":contracts:canonical-api:qualityCheck")
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    systemProperty(
        "taskpilot.canonical-openapi-source",
        rootProject.file("contracts/canonical-api/openapi.yaml").absolutePath,
    )
}

tasks.test {
    val desktopSystemEnabled = System.getProperty("taskpilot.desktop.system") == "true"
    if (!desktopSystemEnabled) {
        filter.excludeTestsMatching("*DesktopSystemJourneyTest")
    } else {
        dependsOn(":services:gateway:bootJar")
    }
    doFirst {
        if (desktopSystemEnabled) {
            systemProperty("taskpilot.desktop.system", "true")
        }
    }
}

val verifyBuildContract =
    tasks.register("verifyBuildContract") {
        group = LifecycleBasePlugin.VERIFICATION_GROUP
        description = "Verifies Core API source layout, dependency, quality-task, and runtime artifact boundaries."
        dependsOn(tasks.named("bootJar"))

        doLast {
            val requiredTasks =
                setOf(
                    "test",
                    "verifyBuildContract",
                    "ktlintCheck",
                    "detekt",
                    "koverXmlReport",
                    "koverHtmlReport",
                    "koverVerify",
                    "qualityCheck",
                )
            check(tasks.names.containsAll(requiredTasks)) { "Missing build tasks: ${requiredTasks - tasks.names}" }
            check("qualityCheck" !in rootProject.tasks.names) {
                "A root qualityCheck is forbidden; use :services:core-api:qualityCheck"
            }

            val expectedSourceSets = setOf("main", "test")
            check(sourceSets.names == expectedSourceSets) {
                "Core API contains non-standard source sets: ${sourceSets.names - expectedSourceSets}"
            }
            val unexpectedSourceDirectories =
                file("src").listFiles().orEmpty().filter { it.isDirectory && it.name !in expectedSourceSets }
            check(unexpectedSourceDirectories.isEmpty()) {
                "Core API contains non-standard source directories: $unexpectedSourceDirectories"
            }
            val expectedTestDirectories = setOf("kotlin", "resources")
            val unexpectedTestDirectories =
                file("src/test").listFiles().orEmpty().filter { it.isDirectory && it.name !in expectedTestDirectories }
            check(unexpectedTestDirectories.isEmpty()) {
                "Core API contains non-standard test source directories: $unexpectedTestDirectories"
            }
            val artificialArchitectureFixtureDirectories =
                file("src/test")
                    .walkTopDown()
                    .filter { it.isDirectory }
                    .filter { directory ->
                        val relativePath = directory.relativeTo(file("src/test")).invariantSeparatorsPath.lowercase()
                        "architecture" in relativePath && "fixture" in relativePath
                    }.toList()
            check(artificialArchitectureFixtureDirectories.isEmpty()) {
                "Core API contains artificial architecture fixture directories: $artificialArchitectureFixtureDirectories"
            }
            val productionJavaFiles = fileTree("src/main") { include("**/*.java") }.files
            check(productionJavaFiles.isEmpty()) {
                "Core API production Java sources remain: $productionJavaFiles"
            }
            val testJavaFiles = fileTree("src/test") { include("**/*.java") }.files
            check(testJavaFiles.isEmpty()) {
                "Core API test Java sources remain: $testJavaFiles"
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
                )
            check(requiredDetektSourceRoots.all { required -> detektSources.any { it.startsWith(required) } }) {
                "Detekt does not cover the standard Kotlin source roots"
            }

            val prohibitedCoordinates =
                setOf(
                    "com.h2database:h2",
                    "org.springframework.boot:spring-boot-starter-data-jpa",
                    "org.springframework.boot:spring-boot-starter-data-jdbc",
                    "org.springframework.kafka:spring-kafka",
                    "org.apache.kafka:kafka-clients",
                    "org.springframework.amqp:spring-rabbit",
                    "com.rabbitmq:amqp-client",
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
                check(
                    jar.manifest.mainAttributes.getValue("Start-Class") == "ai.taskpilot.coreapi.CoreApiApplicationKt",
                ) {
                    "Executable runtime JAR has an unexpected Start-Class"
                }
                val productionMigrations =
                    entries.filter { it.startsWith("BOOT-INF/classes/db/migration/V") }.toSet()
                check(
                    productionMigrations ==
                        setOf("BOOT-INF/classes/db/migration/V1__initialize_taskpilot.sql"),
                ) {
                    "Executable runtime JAR does not contain exactly the production baseline migration: " +
                        productionMigrations
                }
                check(
                    entries.none { entry ->
                        entry.contains("Test.class") ||
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
            ":contracts:canonical-api:qualityCheck",
            tasks.compileKotlin,
            tasks.named("ktlintCheck"),
            tasks.named("detekt"),
            tasks.test,
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
                ":contracts:canonical-api:qualityCheck",
                ":services:core-api:compileKotlin",
                ":services:core-api:ktlintCheck",
                ":services:core-api:detekt",
                ":services:core-api:test",
                ":services:core-api:verifyBuildContract",
                ":services:core-api:koverXmlReport",
                ":services:core-api:koverHtmlReport",
                ":services:core-api:koverVerify",
            )

        fun directDependencyPaths(value: Any?): Set<String> =
            when (value) {
                null -> emptySet()
                is org.gradle.api.Task -> setOf(value.path)
                is org.gradle.api.tasks.TaskProvider<*> -> setOf(value.get().path)
                is String -> setOf(if (value.startsWith(":")) value else "${project.path}:$value")
                is Iterable<*> -> value.flatMapTo(mutableSetOf(), ::directDependencyPaths)
                else -> error("Unsupported task dependency declaration: ${value::class.qualifiedName}")
            }

        val actualQualityDependencies = directDependencyPaths(qualityCheck.get().dependsOn)
        check(actualQualityDependencies.containsAll(requiredQualityDependencies)) {
            "qualityCheck is missing direct dependencies: ${requiredQualityDependencies - actualQualityDependencies}"
        }
        val compileDependencies = directDependencyPaths(tasks.compileKotlin.get().dependsOn)
        check(":contracts:canonical-api:qualityCheck" in compileDependencies) {
            "Core compileKotlin must depend on the canonical contract quality gate"
        }
    }
}
