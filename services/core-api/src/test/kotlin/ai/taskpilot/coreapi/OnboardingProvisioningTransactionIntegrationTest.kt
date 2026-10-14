package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.access.AccessAccountProvisioning
import ai.taskpilot.coreapi.access.FederatedAccountProvisioner
import ai.taskpilot.coreapi.access.FederatedAccountProvisioningRequest
import ai.taskpilot.coreapi.onboarding.OnboardingFederatedAccountProvisioner
import ai.taskpilot.coreapi.project.DefaultProjectProvisioningRequest
import ai.taskpilot.coreapi.project.PersonalProjectProvisioner
import ai.taskpilot.coreapi.workspace.PersonalWorkspaceProvisioner
import ai.taskpilot.coreapi.workspace.PersonalWorkspaceProvisioningRequest
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
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
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(SpringExtension::class)
@ContextConfiguration(classes = [OnboardingProvisioningTransactionIntegrationTest.TestConfiguration::class])
@TestConstructor(autowireMode = TestConstructor.AutowireMode.ALL)
class OnboardingProvisioningTransactionIntegrationTest(
    private val provisioner: FederatedAccountProvisioner,
    private val jdbc: JdbcTemplate,
    private val failureControl: FailureControl,
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

    @BeforeEach
    fun resetDatabase() {
        failureControl.failAfter = null
        jdbc.execute(
            "TRUNCATE TABLE project.project_memberships, project.projects, " +
                "workspace.workspace_memberships, workspace.workspaces, access.terms_acceptances, " +
                "access.external_identities, access.users",
        )
    }

    @Test
    fun `complete registration provisions every required account record atomically`() {
        val result = provisioner.provision(request())

        assertEquals(1, count("access.users"))
        assertEquals(1, count("access.external_identities"))
        assertEquals(1, count("access.terms_acceptances"))
        assertEquals(1, count("workspace.workspaces"))
        assertEquals(1, count("workspace.workspace_memberships"))
        assertEquals(1, count("project.projects"))
        assertEquals(1, count("project.project_memberships"))
        assertEquals("PERSONAL", jdbc.queryForObject("SELECT type FROM workspace.workspaces", String::class.java))
        assertEquals("OWNER", jdbc.queryForObject("SELECT role FROM workspace.workspace_memberships", String::class.java))
        assertEquals("OWNER", jdbc.queryForObject("SELECT role FROM project.project_memberships", String::class.java))
        assertEquals(result.workspaceId, jdbc.queryForObject("SELECT workspace_id FROM project.projects", UUID::class.java))
        assertEquals(result.projectId, jdbc.queryForObject("SELECT id FROM project.projects", UUID::class.java))
    }

    @Test
    fun `failure after any provisioning step rolls back the entire account`() {
        ProvisioningStep.entries.forEach { step ->
            failureControl.failAfter = step
            assertFailsWith<InjectedProvisioningFailure>(step.name) {
                provisioner.provision(request(subject = "subject-${step.name}"))
            }
            ALL_TABLES.forEach { table -> assertEquals(0, count(table), "$table after $step") }
        }
    }

    private fun request(subject: String = "42") =
        FederatedAccountProvisioningRequest(
            UUID.randomUUID(),
            "Mona",
            URI("https://avatars.example/mona.png"),
            "github",
            URI("https://github.com"),
            subject,
            "bundle-v1",
            "terms-v1",
            "privacy-v1",
            "zh-CN",
            Instant.parse("2026-10-14T00:00:00Z"),
        )

    private fun count(table: String) = jdbc.queryForObject("SELECT count(*) FROM $table", Int::class.java)

    enum class ProvisioningStep {
        USER,
        IDENTITY,
        TERMS,
        WORKSPACE,
        WORKSPACE_MEMBERSHIP,
        PROJECT,
        PROJECT_MEMBERSHIP,
    }

    class FailureControl {
        var failAfter: ProvisioningStep? = null

        fun after(step: ProvisioningStep) {
            if (failAfter == step) throw InjectedProvisioningFailure(step)
        }
    }

    class InjectedProvisioningFailure(
        step: ProvisioningStep,
    ) : RuntimeException(step.name)

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    class TestConfiguration {
        @Bean fun dataSource(): DataSource = Companion.dataSource()

        @Bean fun jdbcTemplate(dataSource: DataSource) = JdbcTemplate(dataSource)

        @Bean fun transactionManager(dataSource: DataSource): PlatformTransactionManager = DataSourceTransactionManager(dataSource)

        @Bean fun failureControl() = FailureControl()

        @Bean
        fun accessProvisioning(
            jdbc: JdbcTemplate,
            failure: FailureControl,
        ) = AccessAccountProvisioning { request -> insertAccess(jdbc, failure, request) }

        @Bean
        fun workspaceProvisioning(
            jdbc: JdbcTemplate,
            failure: FailureControl,
        ) = PersonalWorkspaceProvisioner { request -> insertWorkspace(jdbc, failure, request) }

        @Bean
        fun projectProvisioning(
            jdbc: JdbcTemplate,
            failure: FailureControl,
        ) = PersonalProjectProvisioner { request -> insertProject(jdbc, failure, request) }

        @Bean
        fun provisioner(
            access: AccessAccountProvisioning,
            workspaces: PersonalWorkspaceProvisioner,
            projects: PersonalProjectProvisioner,
        ): FederatedAccountProvisioner = OnboardingFederatedAccountProvisioner(access, workspaces, projects)

        private fun insertAccess(
            jdbc: JdbcTemplate,
            failure: FailureControl,
            request: FederatedAccountProvisioningRequest,
        ) {
            val account = request
            jdbc.update(
                "INSERT INTO access.users (id, display_name, avatar_url, status, created_at) " +
                    "VALUES (?, ?, ?, 'ACTIVE', ?)",
                account.userId,
                account.displayName,
                account.avatarUrl?.toASCIIString(),
                account.now.atOffset(ZoneOffset.UTC),
            )
            failure.after(ProvisioningStep.USER)
            jdbc.update(
                "INSERT INTO access.external_identities " +
                    "(id, user_id, provider, authority, subject, linked_at, last_authenticated_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                UUID.randomUUID(),
                account.userId,
                account.provider,
                account.authority.toASCIIString(),
                account.subject,
                account.now.atOffset(ZoneOffset.UTC),
                account.now.atOffset(ZoneOffset.UTC),
            )
            failure.after(ProvisioningStep.IDENTITY)
            jdbc.update(
                "INSERT INTO access.terms_acceptances " +
                    "(id, user_id, legal_bundle_version, terms_version, privacy_version, locale, accepted_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                UUID.randomUUID(),
                account.userId,
                account.legalBundleVersion,
                account.termsVersion,
                account.privacyVersion,
                account.legalLocale,
                account.now.atOffset(ZoneOffset.UTC),
            )
            failure.after(ProvisioningStep.TERMS)
        }

        private fun insertWorkspace(
            jdbc: JdbcTemplate,
            failure: FailureControl,
            request: PersonalWorkspaceProvisioningRequest,
        ): UUID {
            jdbc.update(
                "INSERT INTO workspace.workspaces " +
                    "(id, type, personal_owner_user_id, created_at, updated_at) VALUES (?, 'PERSONAL', ?, ?, ?)",
                request.workspaceId,
                request.ownerUserId,
                request.now.atOffset(ZoneOffset.UTC),
                request.now.atOffset(ZoneOffset.UTC),
            )
            failure.after(ProvisioningStep.WORKSPACE)
            jdbc.update(
                "INSERT INTO workspace.workspace_memberships " +
                    "(id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'OWNER', ?)",
                UUID.randomUUID(),
                request.workspaceId,
                request.ownerUserId,
                request.now.atOffset(ZoneOffset.UTC),
            )
            failure.after(ProvisioningStep.WORKSPACE_MEMBERSHIP)
            return request.workspaceId
        }

        private fun insertProject(
            jdbc: JdbcTemplate,
            failure: FailureControl,
            request: DefaultProjectProvisioningRequest,
        ): UUID {
            jdbc.update(
                "INSERT INTO project.projects " +
                    "(id, workspace_id, name, description, status, version, created_by_user_id, create_request_id, " +
                    "create_request_fingerprint, created_at, updated_at, archived_at) " +
                    "VALUES (?, ?, ?, '', 'ACTIVE', 0, ?, ?, 'onboarding-default', ?, ?, NULL)",
                request.projectId,
                request.workspaceId,
                request.name,
                request.ownerUserId,
                request.projectId,
                request.now.atOffset(ZoneOffset.UTC),
                request.now.atOffset(ZoneOffset.UTC),
            )
            failure.after(ProvisioningStep.PROJECT)
            jdbc.update(
                "INSERT INTO project.project_memberships " +
                    "(id, project_id, user_id, role, created_at) VALUES (?, ?, ?, 'OWNER', ?)",
                UUID.randomUUID(),
                request.projectId,
                request.ownerUserId,
                request.now.atOffset(ZoneOffset.UTC),
            )
            failure.after(ProvisioningStep.PROJECT_MEMBERSHIP)
            return request.projectId
        }
    }

    companion object {
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }

        private fun dataSource(): DataSource = DriverManagerDataSource(postgres.jdbcUrl, postgres.username, postgres.password)

        private val ALL_TABLES =
            listOf(
                "access.users",
                "access.external_identities",
                "access.terms_acceptances",
                "workspace.workspaces",
                "workspace.workspace_memberships",
                "project.projects",
                "project.project_memberships",
            )
    }
}
