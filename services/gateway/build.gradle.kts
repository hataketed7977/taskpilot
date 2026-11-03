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

repositories { mavenCentral() }

val routeManifest =
    configurations.create("routeManifest") {
        isCanBeConsumed = false
        isCanBeResolved = true
        attributes {
            attribute(Category.CATEGORY_ATTRIBUTE, objects.named(Category.DOCUMENTATION))
            attribute(Usage.USAGE_ATTRIBUTE, objects.named("taskpilot-route-manifest"))
        }
    }

dependencyManagement {
    imports {
        mavenBom(
            libs.spring.cloud.dependencies
                .get()
                .toString(),
        )
    }
}

dependencies {
    routeManifest(project(path = ":contracts:canonical-api", configuration = "routeManifestElements"))
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("tools.jackson.module:jackson-module-kotlin")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.cloud:spring-cloud-starter-gateway-server-webflux")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-starter-webflux-test")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
    compilerOptions {
        freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
        allWarningsAsErrors.set(true)
    }
}

ktlint { version.set(libs.versions.ktlint.engine) }

detekt {
    buildUponDefaultConfig = true
    parallel = true
    config.setFrom(files("config/detekt.yml"))
    source.setFrom(files("src/main/kotlin", "src/test/kotlin"))
}
configurations.named("detekt") {
    resolutionStrategy.eachDependency {
        if (requested.group == "org.jetbrains.kotlin") {
            useVersion(
                libs.versions.detekt.kotlin
                    .get(),
            )
        }
    }
}

kover {
    currentProject { sources { includedSourceSets.add("main") } }
    reports {
        filters { excludes { classes("ai.taskpilot.gateway.GatewayApplicationKt") } }
        total {
            xml { onCheck = true }
            html { onCheck = true }
            verify {
                rule("module-wide line coverage") { bound { minValue = 80 } }
                rule("module-wide branch coverage") {
                    bound {
                        minValue = 70
                        coverageUnits =
                            kotlinx.kover.gradle.plugin.dsl.CoverageUnit.BRANCH
                    }
                }
            }
        }
    }
}

tasks.processResources {
    from(routeManifest) {
        into("canonical-api")
        rename { "canonical-routes.json" }
    }
}

tasks.compileKotlin { dependsOn(":contracts:canonical-api:qualityCheck") }

tasks.withType<Test>().configureEach { useJUnitPlatform() }

val verifyBuildContract =
    tasks.register("verifyBuildContract") {
        group = LifecycleBasePlugin.VERIFICATION_GROUP
        dependsOn(tasks.bootJar)
        doLast {
            val prohibited =
                setOf(
                    "org.springframework.boot:spring-boot-starter-webmvc",
                    "org.springframework.boot:spring-boot-starter-jdbc",
                    "org.springframework.boot:spring-boot-starter-data-jpa",
                    "org.springframework.boot:spring-boot-starter-data-redis",
                    "org.flywaydb:flyway-core",
                    "org.postgresql:postgresql",
                    "org.springframework.modulith:spring-modulith-starter-core",
                )
            val runtime =
                configurations.runtimeClasspath
                    .get()
                    .incoming.resolutionResult.allComponents
                    .mapNotNull { it.moduleVersion?.let { version -> "${version.group}:${version.name}" } }
                    .toSet()
            check(
                runtime.none(prohibited::contains),
            ) { "Gateway contains prohibited runtime dependencies: ${runtime.intersect(prohibited)}" }
            check(fileTree("src/main") { include("**/*.java") }.isEmpty) { "Gateway production code must be Kotlin" }
            val jarFile =
                tasks
                    .named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar")
                    .get()
                    .archiveFile
                    .get()
                    .asFile
            JarFile(jarFile).use { jar ->
                val entries =
                    jar
                        .entries()
                        .asSequence()
                        .map { it.name }
                        .toSet()
                check(
                    jar.manifest.mainAttributes.getValue("Start-Class") ==
                        "ai.taskpilot.gateway.GatewayApplicationKt",
                )
                check("BOOT-INF/classes/ai/taskpilot/gateway/GatewayApplicationKt.class" in entries)
                check(entries.none { it.startsWith("BOOT-INF/classes/db/migration/") })
                check(entries.none { it.startsWith("BOOT-INF/classes/ai/taskpilot/coreapi/") })
                check(entries.none { it.startsWith("BOOT-INF/classes/ai/taskpilot/contract/generated/") })
                check(entries.none { it.startsWith("BOOT-INF/lib/canonical-api-") })
                check("BOOT-INF/classes/canonical-api/canonical-routes.json" in entries) {
                    "Gateway executable JAR does not contain the generated canonical route manifest"
                }
            }
        }
    }

val qualityCheck =
    tasks.register("qualityCheck") {
        group = LifecycleBasePlugin.VERIFICATION_GROUP
        dependsOn(
            ":contracts:canonical-api:qualityCheck",
            "classes",
            "test",
            "ktlintCheck",
            "detekt",
            "koverVerify",
            verifyBuildContract,
        )
    }

verifyBuildContract.configure {
    doLast {
        val requiredQualityDependencies =
            setOf(
                ":contracts:canonical-api:qualityCheck",
                ":services:gateway:classes",
                ":services:gateway:test",
                ":services:gateway:ktlintCheck",
                ":services:gateway:detekt",
                ":services:gateway:koverVerify",
                ":services:gateway:verifyBuildContract",
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
            "Gateway compileKotlin must depend on the canonical contract quality gate"
        }
    }
}
