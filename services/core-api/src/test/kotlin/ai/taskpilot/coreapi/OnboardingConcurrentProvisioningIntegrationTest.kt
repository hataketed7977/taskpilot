package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.AccessAccountProvisioning
import ai.taskpilot.coreapi.access.FederatedAccountProvisioner
import ai.taskpilot.coreapi.access.FederatedAccountProvisioningRequest
import ai.taskpilot.coreapi.access.application.ExternalIdentityAlreadyExistsException
import ai.taskpilot.coreapi.access.persistence.JdbcFederatedIdentityStore
import ai.taskpilot.coreapi.onboarding.OnboardingFederatedAccountProvisioner
import ai.taskpilot.coreapi.project.JdbcPersonalProjectProvisioner
import ai.taskpilot.coreapi.project.PersonalProjectProvisioner
import ai.taskpilot.coreapi.workspace.PersonalWorkspaceProvisioner
import ai.taskpilot.coreapi.workspace.infrastructure.JdbcPersonalWorkspaceProvisioner
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.test.context.ContextConfiguration
import org.springframework.test.context.TestConstructor
import org.springframework.test.context.junit.jupiter.SpringExtension
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.annotation.EnableTransactionManagement
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.URI
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.assertEquals

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(SpringExtension::class)
@ContextConfiguration(classes = [OnboardingConcurrentProvisioningIntegrationTest.TestConfiguration::class])
@TestConstructor(autowireMode = TestConstructor.AutowireMode.ALL)
class OnboardingConcurrentProvisioningIntegrationTest(
    private val provisioner: FederatedAccountProvisioner,
    private val jdbc: JdbcTemplate,
) {
    @BeforeAll
    fun migrate() {
        Flyway
            .configure()
            .dataSource(dataSource())
            .locations("classpath:db/migration")
            .load()
            .migrate()
    }

    @AfterAll
    fun stopPostgreSql() = postgres.stop()

    @Test
    fun `concurrent registration of one external identity leaves one complete account`() {
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val attempts =
                (1..2).map { index ->
                    pool.submit(
                        Callable {
                            start.await(5, TimeUnit.SECONDS)
                            runCatching { provisioner.provision(request("User $index")) }
                        },
                    )
                }
            start.countDown()
            val results = attempts.map { it.get(10, TimeUnit.SECONDS) }

            assertEquals(1, results.count(Result<*>::isSuccess))
            assertEquals(1, results.count { it.exceptionOrNull() is ExternalIdentityAlreadyExistsException })
            COMPLETE_ACCOUNT_TABLES.forEach { table ->
                assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM $table", Int::class.java), table)
            }
        } finally {
            pool.shutdownNow()
        }
    }

    private fun request(displayName: String) =
        FederatedAccountProvisioningRequest(
            UUID.randomUUID(),
            displayName,
            null,
            "github",
            URI("https://github.com"),
            "same-subject",
            "bundle-v1",
            "terms-v1",
            "privacy-v1",
            "en",
            Instant.parse("2026-10-14T00:00:00Z"),
        )

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    class TestConfiguration {
        @Bean fun dataSource(): DataSource = Companion.dataSource()

        @Bean fun jdbcTemplate(dataSource: DataSource) = JdbcTemplate(dataSource)

        @Bean fun transactionManager(dataSource: DataSource): PlatformTransactionManager = DataSourceTransactionManager(dataSource)

        @Bean
        fun accessAccountProvisioning(dataSource: DataSource): AccessAccountProvisioning = JdbcFederatedIdentityStore(dataSource)

        @Bean
        fun personalWorkspaceProvisioner(dataSource: DataSource): PersonalWorkspaceProvisioner =
            JdbcPersonalWorkspaceProvisioner(dataSource)

        @Bean
        fun personalProjectProvisioner(dataSource: DataSource): PersonalProjectProvisioner = JdbcPersonalProjectProvisioner(dataSource)

        @Bean
        fun provisioner(
            access: AccessAccountProvisioning,
            workspaces: PersonalWorkspaceProvisioner,
            projects: PersonalProjectProvisioner,
        ): FederatedAccountProvisioner = OnboardingFederatedAccountProvisioner(access, workspaces, projects)
    }

    companion object {
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }

        private fun dataSource(): DataSource = DriverManagerDataSource(postgres.jdbcUrl, postgres.username, postgres.password)

        private val COMPLETE_ACCOUNT_TABLES =
            listOf(
                "access.users",
                "access.external_identities",
                "access.terms_acceptances",
                "workspace.workspaces",
                "workspace.workspace_memberships",
                "project.projects",
                "project.project_memberships",
                "project.boards",
                "project.board_columns",
            )
    }
}
