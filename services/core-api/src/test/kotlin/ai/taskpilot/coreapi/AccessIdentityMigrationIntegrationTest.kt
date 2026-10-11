package ai.taskpilot.coreapi

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.testcontainers.postgresql.PostgreSQLContainer
import java.sql.Connection
import java.sql.DriverManager
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AccessIdentityMigrationIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer

    @BeforeAll
    fun startPostgreSql() {
        postgres = PostgreSQLContainer("postgres:17-alpine")
        postgres.start()
    }

    @AfterAll
    fun stopPostgreSql() {
        postgres.stop()
    }

    @Test
    fun `baseline migration enforces the database schema conventions`() {
        val flyway =
            Flyway
                .configure()
                .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
                .locations("classpath:db/migration")
                .failOnMissingLocations(true)
                .load()

        assertEquals(listOf("1"), flyway.info().pending().map { it.version.version })
        assertEquals(1, flyway.migrate().migrationsExecuted)

        DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { connection ->
            assertEquals(EXPECTED_BUSINESS_TABLES, businessTableNames(connection))
            assertEquals(setOf("flyway_schema_history"), publicTableNames(connection))
            assertEquals(EXPECTED_PRIMARY_KEYS, primaryKeys(connection))
            assertEntityPrimaryKeysAreUuid(connection)
            assertEquals(EXPECTED_CROSS_SCHEMA_FOREIGN_KEYS, crossSchemaForeignKeys(connection))
            assertValidDatabaseObjectNames(connection)
            assertTrue(allTableNames(connection).intersect(REMOVED_TABLES).isEmpty())
        }
    }

    private fun businessTableNames(connection: Connection): Set<String> =
        queryNames(
            connection,
            """
            SELECT table_schema || '.' || table_name AS qualified_name
            FROM information_schema.tables
            WHERE table_schema IN ('access', 'project') AND table_type = 'BASE TABLE'
            """.trimIndent(),
            "qualified_name",
        )

    private fun publicTableNames(connection: Connection): Set<String> =
        queryNames(
            connection,
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            """.trimIndent(),
            "table_name",
        )

    private fun allTableNames(connection: Connection): Set<String> =
        queryNames(
            connection,
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            """.trimIndent(),
            "table_name",
        )

    private fun primaryKeys(connection: Connection): Map<String, String> =
        connection
            .prepareStatement(
                """
                SELECT namespace.nspname || '.' || relation.relname AS qualified_name,
                       string_agg(attribute.attname, ',' ORDER BY key_column.ordinality) AS columns
                FROM pg_constraint constraint_definition
                JOIN pg_class relation ON relation.oid = constraint_definition.conrelid
                JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                CROSS JOIN LATERAL unnest(constraint_definition.conkey)
                    WITH ORDINALITY AS key_column(attribute_number, ordinality)
                JOIN pg_attribute attribute
                  ON attribute.attrelid = relation.oid
                 AND attribute.attnum = key_column.attribute_number
                WHERE constraint_definition.contype = 'p'
                  AND namespace.nspname IN ('access', 'project')
                GROUP BY namespace.nspname, relation.relname
                """.trimIndent(),
            ).use { statement ->
                statement.executeQuery().use { rows ->
                    buildMap {
                        while (rows.next()) put(rows.getString("qualified_name"), rows.getString("columns"))
                    }
                }
            }

    private fun assertEntityPrimaryKeysAreUuid(connection: Connection) {
        val actual =
            queryNames(
                connection,
                """
                SELECT table_schema || '.' || table_name AS qualified_name
                FROM information_schema.columns
                WHERE table_schema IN ('access', 'project')
                  AND column_name = 'id'
                  AND data_type = 'uuid'
                """.trimIndent(),
                "qualified_name",
            )
        assertEquals(ENTITY_TABLES, actual)
    }

    private fun crossSchemaForeignKeys(connection: Connection): Set<String> =
        queryNames(
            connection,
            """
            SELECT source_namespace.nspname || '.' || source_relation.relname || '->' ||
                   target_namespace.nspname || '.' || target_relation.relname AS relationship
            FROM pg_constraint constraint_definition
            JOIN pg_class source_relation ON source_relation.oid = constraint_definition.conrelid
            JOIN pg_namespace source_namespace ON source_namespace.oid = source_relation.relnamespace
            JOIN pg_class target_relation ON target_relation.oid = constraint_definition.confrelid
            JOIN pg_namespace target_namespace ON target_namespace.oid = target_relation.relnamespace
            WHERE constraint_definition.contype = 'f'
              AND source_namespace.nspname <> target_namespace.nspname
              AND source_namespace.nspname IN ('access', 'project')
            """.trimIndent(),
            "relationship",
        )

    private fun assertValidDatabaseObjectNames(connection: Connection) {
        val invalidNames =
            queryNames(
                connection,
                """
                SELECT object_name
                FROM (
                    SELECT conname AS object_name
                    FROM pg_constraint constraint_definition
                    JOIN pg_class relation ON relation.oid = constraint_definition.conrelid
                    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                    WHERE namespace.nspname IN ('access', 'project')
                      AND conname !~ '^(pk|fk|uq|ck)_[a-z0-9_]+$'
                    UNION ALL
                    SELECT indexname AS object_name
                    FROM pg_indexes
                    WHERE schemaname IN ('access', 'project')
                      AND indexname !~ '^(pk|fk|uq|ck|ix|ux)_[a-z0-9_]+$'
                ) database_objects
                WHERE octet_length(object_name) > 63
                   OR object_name !~ '^[a-z][a-z0-9_]*$'
                   OR object_name NOT LIKE '%\_%' ESCAPE '\'
                """.trimIndent(),
                "object_name",
            )
        assertTrue(invalidNames.isEmpty(), "Invalid database object names: $invalidNames")
    }

    private fun queryNames(
        connection: Connection,
        query: String,
        column: String,
    ): Set<String> =
        connection.prepareStatement(query).use { statement ->
            statement.executeQuery().use { rows ->
                buildSet {
                    while (rows.next()) add(rows.getString(column))
                }
            }
        }

    companion object {
        private val EXPECTED_BUSINESS_TABLES =
            setOf(
                "access.users",
                "access.external_identities",
                "access.terms_acceptances",
            )
        private val ENTITY_TABLES = EXPECTED_BUSINESS_TABLES
        private val EXPECTED_PRIMARY_KEYS = ENTITY_TABLES.associateWith { "id" }
        private val EXPECTED_CROSS_SCHEMA_FOREIGN_KEYS = emptySet<String>()
        private val REMOVED_TABLES =
            setOf(
                "email_identities",
                "password_credentials",
                "verification_challenges",
                "auth_continuations",
                "verification_rate_limits",
                "federated_login_attempts",
                "federated_registration_continuations",
                "federated_rate_limits",
                "user_sessions",
                "session_deliveries",
                "refresh_recoveries",
                "workspaces",
                "workspace_memberships",
                "workspace_creation_requests",
                "projects",
                "project_memberships",
            )
    }
}
