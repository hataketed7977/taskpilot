package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.FederatedIdentityProvider
import ai.taskpilot.coreapi.access.application.IssuedSession
import ai.taskpilot.coreapi.access.application.ProviderIdentity
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
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
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.GenericContainer
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.URI
import java.net.URLEncoder
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
    }

    @AfterAll
    fun stopContainers() {
        redisConnection.destroy()
        redis.stop()
        postgres.stop()
    }

    @Test
    fun `Desktop first-use journey crosses the real Core API and PostgreSQL`() {
        val repositoryRoot = findRepositoryRoot()
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
                    "tests/system/first-use-journey.test.ts",
                ).directory(desktopRoot.toFile())
                    .redirectErrorStream(true)
                    .redirectOutput(outputFile.toFile())
                    .apply {
                        environment()["TASKPILOT_SYSTEM_BASE_URL"] = "http://127.0.0.1:$port"
                    }.start()
            val finished = process.waitFor(PROCESS_TIMEOUT.toSeconds(), TimeUnit.SECONDS)
            if (!finished) {
                process.destroyForcibly()
                process.waitFor()
            }
            val output = Files.readString(outputFile)
            assertTrue(finished, "Desktop system journey timed out\n$output")
            assertEquals(0, process.exitValue(), "Desktop system journey failed\n$output")
        } finally {
            Files.deleteIfExists(outputFile)
        }
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
        private val PROCESS_TIMEOUT = Duration.ofMinutes(2)

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
                "http://127.0.0.1:18080/desktop/v1/auth/federated/github/callback"
            }
            registry.add("taskpilot.authentication.github.hmac-key-base64") { hmacKey }
            registry.add("taskpilot.authentication.github.aead-key-base64") { aeadKey }
        }
    }
}

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
    ): SessionUseCases = FailFirstJourneySessionIssue(delegate)
}

private class FailFirstJourneySessionIssue(
    private val delegate: SessionUseCases,
) : SessionUseCases {
    private var failed = false

    override fun issue(user: SessionUser): IssuedSession {
        if (!failed && user.displayName == "Session Failure") {
            failed = true
            error("system journey session issue failure")
        }
        return delegate.issue(user)
    }

    override fun refresh(refreshToken: String): RefreshSessionResult = delegate.refresh(refreshToken)

    override fun currentUser(accessToken: String): CurrentUserResult = delegate.currentUser(accessToken)

    override fun logout(accessToken: String) = delegate.logout(accessToken)
}

private fun encodeQuery(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")
