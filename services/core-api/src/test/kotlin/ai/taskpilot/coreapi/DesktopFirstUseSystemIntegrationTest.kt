package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.infrastructure.CapturingVerificationMailSender
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.core.annotation.Order
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.web.SecurityFilterChain
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.testcontainers.postgresql.PostgreSQLContainer
import java.nio.file.Path
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import kotlin.io.path.exists
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(DesktopFirstUseSystemIntegrationTest.SystemFixtureConfiguration::class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@Suppress("MaxLineLength")
class DesktopFirstUseSystemIntegrationTest(
    @param:LocalServerPort private val port: Int,
) {
    @Autowired private lateinit var jdbc: JdbcTemplate

    @Autowired private lateinit var mail: CapturingVerificationMailSender

    @BeforeAll
    fun migrateSchema() {
        Flyway
            .configure()
            .dataSource(requireNotNull(jdbc.dataSource))
            .locations("classpath:db/migration")
            .load()
            .migrate()
    }

    @BeforeEach
    fun clearState() {
        jdbc.execute(
            """
            TRUNCATE project_memberships, projects, workspace_creation_requests, workspace_memberships, workspaces,
                     refresh_recoveries, user_sessions, auth_continuations, verification_challenges,
                     verification_rate_limits, terms_acceptances, password_credentials,
                     email_identities, app_users
            """.trimIndent(),
        )
        mail.clear()
    }

    @AfterAll fun stopPostgreSql() = postgres.stop()

    @Test
    fun `desktop first use journey crosses production process contracts and real infrastructure`() {
        val repositoryRoot = findRepositoryRoot()
        val command =
            listOf(
                "pnpm",
                "--filter",
                "@taskpilot/desktop",
                "exec",
                "vitest",
                "run",
                "--config",
                "vitest.config.ts",
                "tests/system/first-use-journey.test.ts",
            )
        val process =
            ProcessBuilder(command)
                .directory(repositoryRoot.toFile())
                .redirectErrorStream(true)
                .apply {
                    environment()["TASKPILOT_SYSTEM_BASE_URL"] = "http://127.0.0.1:$port"
                    environment()["TASKPILOT_SYSTEM_FIXTURE_TOKEN"] = FIXTURE_TOKEN
                }.start()
        val output = process.inputStream.bufferedReader().use { it.readText() }
        val completed = process.waitFor() == 0
        assertTrue(completed, "Desktop system journey failed:\n$output")
        assertTrue(output.contains("1 passed"), "Desktop system journey did not report its scenario:\n$output")
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM workspaces", Int::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM workspace_memberships", Int::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM projects", Int::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM project_memberships", Int::class.java))
    }

    @Test
    fun `packaged desktop first use journey executes the app asar through its platform binary`() {
        assumeTrue(
            System.getenv("TASKPILOT_PACKAGED_SYSTEM_JOURNEY") == "true",
            "Packaged release evidence is opt-in and requires a current platform artifact",
        )
        val repositoryRoot = findRepositoryRoot()
        val process =
            ProcessBuilder("node", "apps/desktop/scripts/packaged-first-use-smoke.mjs")
                .directory(repositoryRoot.toFile())
                .redirectErrorStream(true)
                .apply {
                    environment()["TASKPILOT_SYSTEM_BASE_URL"] = "http://127.0.0.1:$port"
                    environment()["TASKPILOT_SYSTEM_FIXTURE_TOKEN"] = FIXTURE_TOKEN
                }.start()
        val output = process.inputStream.bufferedReader().use { it.readText() }
        val completed = process.waitFor() == 0
        assertTrue(completed, "Packaged Desktop system journey failed:\n$output")
        assertTrue(
            output.contains("\"artifact\":\"app.asar\""),
            "Packaged Desktop system journey did not report app.asar evidence:\n$output",
        )
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM workspaces", Int::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM workspace_memberships", Int::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM projects", Int::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM project_memberships", Int::class.java))
    }

    private fun findRepositoryRoot(): Path =
        generateSequence(Path.of("").toAbsolutePath()) { it.parent }
            .firstOrNull { it.resolve("pnpm-workspace.yaml").exists() }
            ?: error("Could not locate repository root")

    @TestConfiguration(proxyBeanMethods = false)
    class SystemFixtureConfiguration {
        @Bean
        @Order(0)
        fun systemFixtureSecurity(http: HttpSecurity): SecurityFilterChain =
            http
                .securityMatcher("/__system-test/**")
                .csrf { it.disable() }
                .authorizeHttpRequests { it.anyRequest().permitAll() }
                .build()

        @Bean
        fun systemFixtureController(
            mail: CapturingVerificationMailSender,
            jdbc: JdbcTemplate,
        ) = SystemFixtureController(mail, jdbc)
    }

    @RestController
    @RequestMapping("/__system-test")
    class SystemFixtureController(
        private val mail: CapturingVerificationMailSender,
        private val jdbc: JdbcTemplate,
    ) {
        @GetMapping("/mail/latest")
        fun latestMail(
            @RequestHeader("X-System-Test-Token") token: String,
            @RequestParam template: String,
            @RequestParam recipient: String,
        ): Map<String, String> {
            authorize(token)
            val command =
                mail.commands.lastOrNull { it.template.name == template && it.recipient == recipient }
                    ?: throw FixtureNotFoundException()
            val field = command.code.javaClass.getDeclaredField("value")
            field.trySetAccessible()
            return mapOf("code" to field.get(command.code).toString())
        }

        @PostMapping("/projects")
        fun createProject(
            @RequestHeader("X-System-Test-Token") token: String,
            @RequestBody request: CreateProjectFixtureRequest,
        ): Map<String, String> {
            authorize(token)
            val projectId = UUID.randomUUID()
            val now = OffsetDateTime.now(ZoneOffset.UTC)
            jdbc.update(
                "INSERT INTO projects(project_id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)",
                projectId,
                request.workspaceId,
                request.name,
                now,
            )
            jdbc.update(
                "INSERT INTO project_memberships(project_id, workspace_id, user_id, joined_at) VALUES (?, ?, ?, ?)",
                projectId,
                request.workspaceId,
                request.userId,
                now,
            )
            return mapOf(
                "projectId" to projectId.toString(),
                "workspaceId" to request.workspaceId.toString(),
                "name" to request.name,
            )
        }

        private fun authorize(token: String) {
            if (token != FIXTURE_TOKEN) throw FixtureNotFoundException()
        }
    }

    data class CreateProjectFixtureRequest(
        val userId: UUID,
        val workspaceId: UUID,
        val name: String,
    )

    @ResponseStatus(HttpStatus.NOT_FOUND)
    class FixtureNotFoundException : RuntimeException()

    companion object {
        private const val FIXTURE_TOKEN = "desktop-system-fixture-token"
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }
        private val pepper = Base64.getEncoder().encodeToString(ByteArray(32) { 23 })
        private val recoveryKey = Base64.getEncoder().encodeToString(ByteArray(32) { 29 })

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
            registry.add("taskpilot.verification.enabled") { "true" }
            registry.add("taskpilot.verification.mail-adapter") { "capture" }
            registry.add("taskpilot.verification.pepper-base64") { pepper }
            registry.add("taskpilot.authentication.enabled") { "true" }
            registry.add("taskpilot.authentication.token-pepper-base64") { pepper }
            registry.add("taskpilot.authentication.recovery-key-base64") { recoveryKey }
            registry.add("taskpilot.authentication.terms-version") { "2026-09" }
            registry.add("taskpilot.authentication.argon2.memory-kib") { "1024" }
            registry.add("taskpilot.authentication.argon2.iterations") { "1" }
        }
    }
}
