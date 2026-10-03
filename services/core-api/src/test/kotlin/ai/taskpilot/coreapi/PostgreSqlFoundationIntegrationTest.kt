package ai.taskpilot.coreapi

import org.flywaydb.core.Flyway
import org.testcontainers.postgresql.PostgreSQLContainer
import java.sql.DriverManager
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

class PostgreSqlFoundationIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer

    @BeforeTest
    fun startPostgreSql() {
        postgres = PostgreSQLContainer("postgres:17-alpine")
        postgres.start()
    }

    @AfterTest
    fun stopPostgreSql() {
        postgres.stop()
    }

    @Test
    fun `real PostgreSQL runs the isolated Flyway probe`() {
        DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { connection ->
            assertEquals("PostgreSQL", connection.metaData.databaseProductName)
        }
        val flyway =
            Flyway
                .configure()
                .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
                .locations("classpath:db/integration")
                .load()
        assertEquals(1, flyway.info().pending().size, "probe migration must be pending before migrate")
        assertEquals(1, flyway.migrate().migrationsExecuted)
        assertEquals(0, flyway.info().pending().size)
    }
}
