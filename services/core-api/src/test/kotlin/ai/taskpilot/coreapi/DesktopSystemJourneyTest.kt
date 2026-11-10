package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.FederatedIdentityProvider
import ai.taskpilot.coreapi.access.application.IssuedSession
import ai.taskpilot.coreapi.access.application.ProviderIdentity
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.SecretDigester
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.access.application.SessionUser
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.condition.EnabledIfSystemProperty
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.data.redis.connection.RedisStandaloneConfiguration
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.GenericContainer
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.ServerSocket
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.util.Base64
import java.util.concurrent.TimeUnit
import kotlin.io.path.exists
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    classes = [CoreApiApplication::class, DesktopSystemJourneyConfiguration::class],
)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@EnabledIfSystemProperty(named = "taskpilot.desktop.system", matches = "true")
class DesktopSystemJourneyTest(
    @param:LocalServerPort private val port: Int,
) {
    private lateinit var redisConnection: LettuceConnectionFactory
    private lateinit var repositoryRoot: Path
    private lateinit var gateway: GatewayProcess

    @BeforeAll
    fun prepareState() {
        Flyway
            .configure()
            .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
            .locations("classpath:db/migration")
            .load()
            .migrate()
        redisConnection = LettuceConnectionFactory(RedisStandaloneConfiguration(redis.host, redis.getMappedPort(6379)))
        redisConnection.afterPropertiesSet()
        redisConnection.connection.serverCommands().flushAll()
        repositoryRoot = findRepositoryRoot()
        gateway = startGateway(gatewayPort, port)
        awaitGatewayHealth(gatewayPort, "readiness", 200, gateway)
    }

    @AfterAll
    fun stopContainers() {
        if (::gateway.isInitialized) stopGateway(gateway)
        if (::redisConnection.isInitialized) redisConnection.destroy()
        redis.stop()
        postgres.stop()
    }

    @Test
    fun `Desktop journeys cross Gateway and fail closed when either service is unavailable`() {
        assertTrue(gatewayPort != port, "Gateway and Core API must use distinct ports")
        runDesktopJourney("tests/system/first-use-journey.test.ts", testNamePattern = "crosses provider")
        // Separate journeys share localhost; reset only the test container's rate counters,
        // preserving all real sessions, identities, and the production limiter policy.
        val redisTemplate = StringRedisTemplate(redisConnection)
        redisTemplate.delete(redisTemplate.keys("taskpilot:auth:rate:*"))
        runDesktopJourney("tests/system/first-use-journey.test.ts", testNamePattern = "explicitly retries")

        stopGateway(gateway)
        runDesktopJourney(
            "tests/system/gateway-failure-journey.test.ts",
            mapOf("TASKPILOT_SYSTEM_FAILURE_SCENARIO" to "gateway-stopped"),
        )

        val unavailableCorePort = availablePort()
        gateway = startGateway(gatewayPort, unavailableCorePort)
        awaitGatewayHealth(gatewayPort, "liveness", 200, gateway)
        awaitGatewayHealth(gatewayPort, "readiness", 503, gateway)
        runDesktopJourney(
            "tests/system/gateway-failure-journey.test.ts",
            mapOf("TASKPILOT_SYSTEM_FAILURE_SCENARIO" to "core-unavailable"),
        )
    }

    private fun runDesktopJourney(
        testFile: String,
        additionalEnvironment: Map<String, String> = emptyMap(),
        testNamePattern: String = ".*",
    ) {
        val desktopRoot = repositoryRoot.resolve("apps/desktop")
        val outputFile = Files.createTempFile("taskpilot-desktop-system-", ".log")
        try {
            val process =
                ProcessBuilder(
                    "pnpm",
                    "exec",
                    "vitest",
                    "run",
                    "--config",
                    "vitest.config.ts",
                    testFile,
                    "--testNamePattern",
                    testNamePattern,
                ).directory(desktopRoot.toFile())
                    .redirectErrorStream(true)
                    .redirectOutput(outputFile.toFile())
                    .apply {
                        environment().remove("TASKPILOT_CORE_API_URL")
                        environment().remove("TASKPILOT_CORE_API_INTERNAL_URL")
                        environment().remove("TASKPILOT_CORE_API_PORT")
                        environment()["TASKPILOT_SYSTEM_BASE_URL"] = "http://127.0.0.1:$gatewayPort"
                        environment().putAll(additionalEnvironment)
                    }.start()
            val finished = process.waitFor(PROCESS_TIMEOUT.toSeconds(), TimeUnit.SECONDS)
            if (!finished) {
                process.destroyForcibly()
                process.waitFor()
            }
            val output = Files.readString(outputFile)
            assertTrue(finished, "Desktop system journey timed out ($testFile)\n$output")
            assertEquals(0, process.exitValue(), "Desktop system journey failed ($testFile)\n$output")
        } finally {
            Files.deleteIfExists(outputFile)
        }
    }

    private fun startGateway(
        publicPort: Int,
        corePort: Int,
    ): GatewayProcess {
        val jar = resolveGatewayJar(repositoryRoot)
        val output = Files.createTempFile("taskpilot-gateway-system-", ".log")
        val process =
            ProcessBuilder("java", "-jar", jar.toString())
                .directory(repositoryRoot.toFile())
                .redirectErrorStream(true)
                .redirectOutput(output.toFile())
                .apply {
                    environment()["TASKPILOT_GATEWAY_HOST"] = "127.0.0.1"
                    environment()["TASKPILOT_GATEWAY_PORT"] = publicPort.toString()
                    environment()["TASKPILOT_CORE_API_INTERNAL_URL"] = "http://127.0.0.1:$corePort"
                }.start()
        return GatewayProcess(process, output)
    }

    private fun stopGateway(running: GatewayProcess) {
        if (running.process.isAlive) {
            running.process.destroy()
            if (!running.process.waitFor(PROCESS_STOP_TIMEOUT.toSeconds(), TimeUnit.SECONDS)) {
                running.process.destroyForcibly()
                running.process.waitFor()
            }
        }
        Files.deleteIfExists(running.output)
    }

    private fun awaitGatewayHealth(
        publicPort: Int,
        group: String,
        expectedStatus: Int,
        running: GatewayProcess,
    ) {
        val uri = URI("http://127.0.0.1:$publicPort/actuator/health/$group")
        val deadline = System.nanoTime() + GATEWAY_START_TIMEOUT.toNanos()
        var lastFailure: Throwable? = null
        while (System.nanoTime() < deadline) {
            if (!running.process.isAlive) {
                error("Gateway exited before $group became available\n${Files.readString(running.output)}")
            }
            try {
                val response =
                    HTTP_CLIENT.send(
                        HttpRequest
                            .newBuilder(uri)
                            .timeout(HEALTH_REQUEST_TIMEOUT)
                            .GET()
                            .build(),
                        HttpResponse.BodyHandlers.discarding(),
                    )
                if (response.statusCode() == expectedStatus) return
            } catch (failure: Exception) {
                lastFailure = failure
            }
            Thread.sleep(100)
        }
        val logs = Files.readString(running.output)
        error("Gateway $group did not return $expectedStatus at $uri; lastFailure=$lastFailure\n$logs")
    }

    private fun resolveGatewayJar(root: Path): Path {
        val jars =
            Files.list(root.resolve("services/gateway/build/libs")).use { paths ->
                paths
                    .filter { candidate -> candidate.fileName.toString().endsWith(".jar") }
                    .filter { candidate -> !candidate.fileName.toString().endsWith("-plain.jar") }
                    .toList()
            }
        check(jars.size == 1) { "Expected exactly one packaged Gateway boot jar, found: $jars" }
        return jars.single()
    }

    private fun findRepositoryRoot(): Path {
        var candidate = Path.of("").toAbsolutePath().normalize()
        while (true) {
            if (candidate.resolve("pnpm-workspace.yaml").exists() && candidate.resolve("gradlew").exists()) return candidate
            candidate = candidate.parent ?: error("Unable to locate TaskPilot repository root")
        }
    }

    companion object {
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }
        private val redis = DesktopSystemRedisContainer().withExposedPorts(6379).apply { start() }
        private val pepper = Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
        private val hmacKey = Base64.getEncoder().encodeToString(ByteArray(32) { 31 })
        private val aeadKey = Base64.getEncoder().encodeToString(ByteArray(32) { 63 })
        private val gatewayPort = availablePort()
        private val PROCESS_TIMEOUT = Duration.ofMinutes(2)
        private val PROCESS_STOP_TIMEOUT = Duration.ofSeconds(10)
        private val GATEWAY_START_TIMEOUT = Duration.ofSeconds(30)
        private val HEALTH_REQUEST_TIMEOUT = Duration.ofSeconds(2)
        private val HTTP_CLIENT = HttpClient.newBuilder().connectTimeout(HEALTH_REQUEST_TIMEOUT).build()

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
            registry.add("spring.data.redis.host", redis::getHost)
            registry.add("spring.data.redis.port") { redis.getMappedPort(6379) }
            registry.add("taskpilot.authentication.enabled") { "true" }
            registry.add("taskpilot.authentication.token-pepper-base64") { pepper }
            registry.add("taskpilot.authentication.legal-bundle-version") { "2026-09" }
            registry.add("taskpilot.authentication.terms-version") { "terms-2026-09" }
            registry.add("taskpilot.authentication.privacy-version") { "privacy-2026-09" }
            registry.add("taskpilot.authentication.legal-locales") { "zh-CN,en" }
            registry.add("taskpilot.authentication.github.client-id") { "client-id" }
            registry.add("taskpilot.authentication.github.client-secret") { "client-secret" }
            registry.add("taskpilot.authentication.github.callback-uri") {
                "http://127.0.0.1:$gatewayPort/v1/provider-callbacks/github/oauth"
            }
            registry.add("taskpilot.authentication.github.hmac-key-base64") { hmacKey }
            registry.add("taskpilot.authentication.github.aead-key-base64") { aeadKey }
        }
    }
}

private data class GatewayProcess(
    val process: Process,
    val output: Path,
)

private fun availablePort(): Int = ServerSocket(0).use { it.localPort }

private class DesktopSystemRedisContainer : GenericContainer<DesktopSystemRedisContainer>("redis:7.4-alpine")

@TestConfiguration(proxyBeanMethods = false)
class DesktopSystemJourneyConfiguration {
    @Bean
    @Primary
    fun desktopSystemIdentityProvider(): FederatedIdentityProvider =
        object : FederatedIdentityProvider {
            override fun authorizationUri(
                state: String,
                pkceChallenge: String,
            ): URI =
                URI(
                    "https://github.com/login/oauth/authorize?client_id=client-id&state=${encodeQuery(
                        state,
                    )}&code_challenge=${encodeQuery(pkceChallenge)}&code_challenge_method=S256",
                )

            override fun resolveIdentity(
                authorizationCode: String,
                pkceVerifier: String,
            ) = ProviderIdentity(
                "github",
                URI("https://github.com"),
                authorizationCode,
                "Journey $authorizationCode",
                URI("https://avatars.githubusercontent.com/u/$authorizationCode"),
            )
        }

    @Bean
    @Primary
    fun desktopSystemSessions(
        @Qualifier("sessionUseCases") delegate: SessionUseCases,
        redis: StringRedisTemplate,
        @Qualifier("sessionSecretDigester") digester: SecretDigester,
    ): SessionUseCases = FailFirstJourneySessionIssue(delegate, redis, digester)
}

private class FailFirstJourneySessionIssue(
    private val delegate: SessionUseCases,
    private val redis: StringRedisTemplate,
    private val digester: SecretDigester,
) : SessionUseCases {
    private var failRecoveryRefresh: String? = null
    private var failed = false

    override fun issue(user: SessionUser): IssuedSession {
        if (!failed && user.displayName == "Session Failure") {
            failed = true
            error("system journey session issue failure")
        }
        val issued = delegate.issue(user)
        if (user.displayName == "Recovery Journey") {
            failRecoveryRefresh = issued.refreshToken
            expireAccessIndex(issued)
        }
        return issued
    }

    override fun refresh(refreshToken: String): RefreshSessionResult {
        if (refreshToken == failRecoveryRefresh) {
            failRecoveryRefresh = null
            error("system journey temporary refresh failure")
        }
        val result = delegate.refresh(refreshToken)
        if (result is RefreshSessionResult.Refreshed && result.session.currentUser.displayName == "Recovery Journey") {
            expireAccessIndex(result.session)
        }
        return result
    }

    private fun expireAccessIndex(session: IssuedSession) {
        val digest = digester.digest("session:access", session.accessToken).encoded
        redis.expire("taskpilot:auth:access:$digest", Duration.ofMillis(200))
    }

    override fun currentUser(accessToken: String): CurrentUserResult = delegate.currentUser(accessToken)

    override fun logout(accessToken: String) = delegate.logout(accessToken)

    override fun logoutByRefreshToken(refreshToken: String) = delegate.logoutByRefreshToken(refreshToken)
}

private fun encodeQuery(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")
