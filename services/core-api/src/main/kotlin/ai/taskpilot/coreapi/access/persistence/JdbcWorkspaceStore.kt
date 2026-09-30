package ai.taskpilot.coreapi.access.persistence

import ai.taskpilot.coreapi.access.WorkspaceAuthorizationUnavailableException
import ai.taskpilot.coreapi.access.WorkspaceMembershipAuthorizer
import ai.taskpilot.coreapi.access.application.CreateWorkspaceResult
import ai.taskpilot.coreapi.access.application.WorkspaceStore
import ai.taskpilot.coreapi.access.application.WorkspaceStoreUnavailableException
import ai.taskpilot.coreapi.access.application.workspacePayloadHash
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.Workspace
import ai.taskpilot.coreapi.access.model.WorkspaceId
import ai.taskpilot.coreapi.access.model.WorkspaceType
import org.springframework.dao.DataAccessException
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.sql.SQLException
import java.time.Clock
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource

class JdbcWorkspaceStore(
    dataSource: DataSource,
    private val clock: Clock = Clock.systemUTC(),
) : WorkspaceStore,
    WorkspaceMembershipAuthorizer {
    private val jdbc = JdbcTemplate(dataSource)
    private val transaction = TransactionTemplate(DataSourceTransactionManager(dataSource))

    override fun create(
        actor: UserId,
        idempotencyKey: String,
        workspace: Workspace,
    ): CreateWorkspaceResult {
        val payloadHash = workspacePayloadHash(workspace)
        return try {
            requireNotNull(
                transaction.execute {
                    insertWorkspace(workspace)
                    insertMembership(actor, workspace.workspaceId)
                    insertCompletedRequest(actor, idempotencyKey, payloadHash, workspace.workspaceId)
                    CreateWorkspaceResult.Created(workspace)
                },
            )
        } catch (failure: DataIntegrityViolationException) {
            recoverCreationConflict(failure, actor, idempotencyKey, payloadHash)
        } catch (failure: DataAccessException) {
            throw WorkspaceStoreUnavailableException(failure)
        }
    }

    private fun recoverCreationConflict(
        failure: DataIntegrityViolationException,
        actor: UserId,
        idempotencyKey: String,
        payloadHash: String,
    ): CreateWorkspaceResult {
        if (!failure.isCreationRequestConflict()) unavailable(failure)
        return try {
            findCompletedRequest(actor, idempotencyKey)?.let { existing ->
                if (existing.payloadHash == payloadHash) {
                    CreateWorkspaceResult.Replayed(existing.workspace)
                } else {
                    CreateWorkspaceResult.IdempotencyConflict
                }
            } ?: unavailable(failure)
        } catch (readFailure: DataAccessException) {
            unavailable(readFailure)
        }
    }

    private fun unavailable(cause: DataAccessException): Nothing = throw WorkspaceStoreUnavailableException(cause)

    override fun canAccess(
        userId: UUID,
        workspaceId: UUID,
    ): Boolean =
        try {
            jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM workspace_memberships WHERE user_id = ? AND workspace_id = ?)",
                Boolean::class.java,
                userId,
                workspaceId,
            ) == true
        } catch (failure: DataAccessException) {
            throw WorkspaceAuthorizationUnavailableException(failure)
        }

    override fun listAccessible(actor: UserId): List<Workspace> =
        try {
            jdbc.query(
                """
                SELECT w.workspace_id, w.name, w.workspace_type
                FROM workspaces w
                JOIN workspace_memberships m ON m.workspace_id = w.workspace_id
                WHERE m.user_id = ?
                ORDER BY m.joined_at, w.workspace_id
                """.trimIndent(),
                workspaceRowMapper,
                actor.value,
            )
        } catch (failure: DataAccessException) {
            throw WorkspaceStoreUnavailableException(failure)
        }

    private fun insertWorkspace(workspace: Workspace) {
        jdbc.update(
            "INSERT INTO workspaces (workspace_id, name, workspace_type, created_at) VALUES (?, ?, ?, ?)",
            workspace.workspaceId.value,
            workspace.name,
            workspace.type.name,
            OffsetDateTime.now(clock),
        )
    }

    private fun insertMembership(
        actor: UserId,
        workspaceId: WorkspaceId,
    ) {
        jdbc.update(
            "INSERT INTO workspace_memberships (workspace_id, user_id, joined_at) VALUES (?, ?, ?)",
            workspaceId.value,
            actor.value,
            OffsetDateTime.now(clock),
        )
    }

    private fun insertCompletedRequest(
        actor: UserId,
        key: String,
        payloadHash: String,
        workspaceId: WorkspaceId,
    ) {
        jdbc.update(
            """
            INSERT INTO workspace_creation_requests (
                actor_user_id, operation, idempotency_key, payload_hash, workspace_id, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            actor.value,
            CREATE_OPERATION,
            key,
            payloadHash,
            workspaceId.value,
            OffsetDateTime.now(clock),
        )
    }

    private fun findCompletedRequest(
        actor: UserId,
        key: String,
    ): CompletedRequest? =
        jdbc
            .query(
                """
                SELECT r.payload_hash, w.workspace_id, w.name, w.workspace_type
                FROM workspace_creation_requests r
                JOIN workspaces w ON w.workspace_id = r.workspace_id
                WHERE r.actor_user_id = ? AND r.operation = ? AND r.idempotency_key = ?
                """.trimIndent(),
                { rows, _ -> CompletedRequest(rows.getString("payload_hash"), workspaceRowMapper.mapRow(rows, 0)) },
                actor.value,
                CREATE_OPERATION,
                key,
            ).singleOrNull()

    private fun Throwable.isCreationRequestConflict(): Boolean =
        generateSequence<Throwable>(this) { it.cause }
            .filterIsInstance<SQLException>()
            .any { it.sqlState == UNIQUE_VIOLATION && it.message.orEmpty().contains(CREATION_REQUEST_PRIMARY_KEY) }

    private data class CompletedRequest(
        val payloadHash: String,
        val workspace: Workspace,
    )

    private companion object {
        const val CREATE_OPERATION = "CREATE_ORGANIZATION_WORKSPACE"
        const val UNIQUE_VIOLATION = "23505"
        const val CREATION_REQUEST_PRIMARY_KEY = "workspace_creation_requests_pkey"
        val workspaceRowMapper =
            RowMapper { rows: ResultSet, _: Int ->
                Workspace(
                    WorkspaceId(rows.getObject("workspace_id", UUID::class.java)),
                    rows.getString("name"),
                    WorkspaceType.valueOf(rows.getString("workspace_type")),
                )
            }
    }
}
