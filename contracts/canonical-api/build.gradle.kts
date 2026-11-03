import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.openapitools.generator.gradle.plugin.tasks.GenerateTask

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.openapi.generator)
    alias(libs.plugins.spring.dependency.management)
}

group = "ai.taskpilot.contract"
version = "0.1.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(libs.versions.java.get().toInt())
    }
}

repositories { mavenCentral() }

dependencyManagement {
    imports {
        mavenBom("org.springframework.boot:spring-boot-dependencies:${libs.versions.spring.boot.get()}")
    }
}

val generatedRoot = layout.buildDirectory.dir("generated/openapi")
val generatedKotlin = generatedRoot.map { it.dir("src/main/kotlin") }
val manifestFile = layout.buildDirectory.file("generated/manifest/canonical-routes.json")
val manifestVerificationFile = layout.buildDirectory.file("generated/manifest-verification/canonical-routes.json")
val canonicalOpenApiFile = layout.projectDirectory.file("openapi.yaml")

sourceSets.main {
    kotlin.srcDir(generatedKotlin)
}

dependencies {
    implementation(libs.swagger.parser)
    implementation("org.jetbrains.kotlin:kotlin-reflect")

    // Compile-only surface required by generated Spring HTTP interfaces/models.
    compileOnly("org.springframework:spring-web")
    compileOnly("org.springframework:spring-context")
    compileOnly("org.springframework:spring-core")
    compileOnly("org.springframework:spring-beans")
    compileOnly("org.springframework.boot:spring-boot-starter-validation")
    compileOnly("jakarta.servlet:jakarta.servlet-api")
    compileOnly("io.swagger.core.v3:swagger-annotations-jakarta:2.2.55")
    compileOnly("com.fasterxml.jackson.core:jackson-annotations:2.21")

    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
        allWarningsAsErrors.set(true)
    }
}

tasks.named<GenerateTask>("openApiGenerate") {
    generatorName.set("kotlin-spring")
    inputSpec.set(layout.projectDirectory.file("openapi.yaml").asFile.absolutePath)
    outputDir.set(generatedRoot.get().asFile.absolutePath)
    configFile.set(layout.projectDirectory.file("config/openapi-generator.yaml").asFile.absolutePath)
    validateSpec.set(true)
    globalProperties.set(
        mapOf(
            "apis" to "",
            "models" to "",
            "supportingFiles" to "ApiUtil.kt",
            "apiTests" to "false",
            "modelTests" to "false",
            "apiDocs" to "false",
            "modelDocs" to "false",
        ),
    )
}

tasks.named("compileKotlin") { dependsOn("openApiGenerate") }
tasks.withType<Test>().configureEach { useJUnitPlatform() }

val validateContract = tasks.register<JavaExec>("validateContract") {
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    description = "Validates canonical OpenAPI syntax, semantics, and secret hygiene."
    dependsOn("classes")
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("ai.taskpilot.contracts.ContractToolKt")
    args("validate", canonicalOpenApiFile.asFile.absolutePath)
}

val generateRouteManifest = tasks.register<JavaExec>("generateRouteManifest") {
    group = LifecycleBasePlugin.BUILD_GROUP
    description = "Projects the canonical OpenAPI ingress operations into a deterministic route manifest."
    dependsOn("classes")
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("ai.taskpilot.contracts.ContractToolKt")
    args(
        "manifest",
        layout.projectDirectory.file("openapi.yaml").asFile.absolutePath,
        manifestFile.get().asFile.absolutePath,
    )
    outputs.file(manifestFile)
}

val generateRouteManifestVerification = tasks.register<JavaExec>("generateRouteManifestVerification") {
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    dependsOn("classes")
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("ai.taskpilot.contracts.ContractToolKt")
    args(
        "manifest",
        layout.projectDirectory.file("openapi.yaml").asFile.absolutePath,
        manifestVerificationFile.get().asFile.absolutePath,
    )
    outputs.file(manifestVerificationFile)
}

val verifyDeterminism = tasks.register("verifyDeterminism") {
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    dependsOn(generateRouteManifest, generateRouteManifestVerification)
    doLast {
        check(manifestFile.get().asFile.readBytes().contentEquals(manifestVerificationFile.get().asFile.readBytes())) {
            "Gateway route manifest generation is not deterministic"
        }
    }
}

val verifyArtifactBoundary = tasks.register("verifyArtifactBoundary") {
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    dependsOn("openApiGenerate", generateRouteManifest)
    doLast {
        val projectRoot = project.rootDir.toPath().toRealPath()
        listOf(generatedRoot.get().asFile, manifestFile.get().asFile).forEach { output ->
            check(output.toPath().toRealPath().startsWith(layout.buildDirectory.get().asFile.toPath().toRealPath())) {
                "Generated output escaped Gradle build/: $output"
            }
            val relative = projectRoot.relativize(output.toPath().toRealPath()).toString()
            val tracked = providers.exec {
                workingDir = rootDir
                isIgnoreExitValue = true
                commandLine("git", "ls-files", "--error-unmatch", relative)
            }.result.get().exitValue == 0
            check(!tracked) { "Generated artifact must not be tracked: $relative" }
        }
    }
}

tasks.register("qualityCheck") {
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    description = "Runs canonical contract validation, generation, projection, tests, and boundary checks."
    dependsOn("test", validateContract, generateRouteManifest, verifyDeterminism, verifyArtifactBoundary)
}

configurations.create("routeManifestElements") {
    isCanBeConsumed = true
    isCanBeResolved = false
    attributes {
        attribute(Category.CATEGORY_ATTRIBUTE, objects.named(Category.DOCUMENTATION))
        attribute(Usage.USAGE_ATTRIBUTE, objects.named("taskpilot-route-manifest"))
    }
    outgoing.artifact(manifestFile) { builtBy(generateRouteManifest) }
}


configurations.create("canonicalOpenApiElements") {
    isCanBeConsumed = true
    isCanBeResolved = false
    attributes {
        attribute(Category.CATEGORY_ATTRIBUTE, objects.named(Category.DOCUMENTATION))
        attribute(Usage.USAGE_ATTRIBUTE, objects.named("taskpilot-canonical-openapi"))
    }
    outgoing.artifact(canonicalOpenApiFile) { builtBy(validateContract) }
}
