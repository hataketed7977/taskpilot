package ai.taskpilot.coreapi.workspace.infrastructure

import ai.taskpilot.coreapi.workspace.WorkspaceAccessQuery
import ai.taskpilot.coreapi.workspace.WorkspaceRole
import ai.taskpilot.coreapi.workspace.WorkspaceType
import ai.taskpilot.coreapi.workspace.WorkspaceUseCases
import ai.taskpilot.coreapi.workspace.WorkspaceView
import org.springframework.jdbc.core.JdbcTemplate
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource

class JdbcWorkspaceAccessService(
    dataSource: DataSource,
) : WorkspaceAccessQuery,
    WorkspaceUseCases {
    private val jdbc = JdbcTemplate(dataSource)

    override fun roleFor(
        userId: UUID,
        workspaceId: UUID,
    ): WorkspaceRole? =
        jdbc
            .query(
                """
                SELECT m.role
                FROM workspace.workspace_memberships m
                JOIN workspace.workspaces w ON w.id = m.workspace_id AND w.type = 'PERSONAL'
                WHERE m.user_id = ? AND m.workspace_id = ?
                """.trimIndent(),
                { rows, _ -> WorkspaceRole.valueOf(rows.getString("role")) },
                userId,
                workspaceId,
            ).singleOrNull()

    override fun listFor(userId: UUID): List<WorkspaceView> =
        jdbc.query(
            """
            SELECT w.id, w.type, m.role, w.created_at, w.updated_at
            FROM workspace.workspace_memberships m
            JOIN workspace.workspaces w ON w.id = m.workspace_id AND w.type = 'PERSONAL'
            WHERE m.user_id = ?
            ORDER BY w.created_at, w.id
            """.trimIndent(),
            { rows, _ ->
                WorkspaceView(
                    rows.getObject("id", UUID::class.java),
                    WorkspaceType.valueOf(rows.getString("type")),
                    WorkspaceRole.valueOf(rows.getString("role")),
                    rows.getObject("created_at", java.time.OffsetDateTime::class.java).withOffsetSameInstant(ZoneOffset.UTC).toInstant(),
                    rows.getObject("updated_at", java.time.OffsetDateTime::class.java).withOffsetSameInstant(ZoneOffset.UTC).toInstant(),
                )
            },
            userId,
        )
}
