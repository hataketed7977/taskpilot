import java.io.File
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

val architectureFixtures =
    sourceSets.create("architectureFixtures") {
        java.setSrcDirs(listOf("src/test/architecture-fixtures/java"))
        resources.setSrcDirs(emptyList<String>())
    }

dependencies {
    implementation(platform(libs.spring.modulith.bom))
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("tools.jackson.module:jackson-module-kotlin")
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

val architectureFixturesClasses = tasks.named(architectureFixtures.classesTaskName)

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

tasks.test {
    dependsOn(architectureFixturesClasses)
    inputs.files(architectureFixtures.output.classesDirs).withPropertyName("architectureFixturesClasses")
    doFirst {
        systemProperty(
            "taskpilot.architectureFixtures.classesDir",
            architectureFixtures.output.classesDirs.files
                .joinToString(File.pathSeparator) { it.absolutePath },
        )
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

            val removedSourceDirectories =
                listOf(
                    file("src/moduleTest"),
                    file("src/integrationTest"),
                    file("src/architectureFixtures"),
                )
            check(removedSourceDirectories.none { it.exists() }) {
                "Removed source directories remain: ${removedSourceDirectories.filter { it.exists() }}"
            }
            val productionJavaFiles = fileTree("src/main") { include("**/*.java") }.files
            check(productionJavaFiles.isEmpty()) {
                "Core API production Java sources remain: $productionJavaFiles"
            }

            val testTask = tasks.named<Test>("test").get()
            val fixtureOutput =
                architectureFixtures.output.classesDirs.files
                    .map { it.canonicalFile }
                    .toSet()
            val fixtureOutputOnTestRuntime =
                testTask.classpath.files
                    .map { it.canonicalFile }
                    .intersect(fixtureOutput)
            check(fixtureOutputOnTestRuntime.isEmpty()) {
                "Isolated ArchUnit fixture output leaked onto the test runtime classpath: $fixtureOutputOnTestRuntime"
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
    }
}
