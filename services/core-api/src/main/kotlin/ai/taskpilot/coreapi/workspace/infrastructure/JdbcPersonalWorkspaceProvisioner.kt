package ai.taskpilot.coreapi.workspace.infrastructure

import ai.taskpilot.coreapi.workspace.PersonalWorkspaceProvisioner
import ai.taskpilot.coreapi.workspace.PersonalWorkspaceProvisioningRequest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource

class JdbcPersonalWorkspaceProvisioner(
    dataSource: DataSource,
) : PersonalWorkspaceProvisioner {
    private val jdbc = JdbcTemplate(dataSource)

    override fun provisionPersonalWorkspace(request: PersonalWorkspaceProvisioningRequest): UUID {
        val timestamp = request.now.atOffset(ZoneOffset.UTC)
        jdbc.update(
            """
            INSERT INTO workspace.workspaces (id, type, personal_owner_user_id, created_at, updated_at)
            VALUES (?, 'PERSONAL', ?, ?, ?)
            """.trimIndent(),
            request.workspaceId,
            request.ownerUserId,
            timestamp,
            timestamp,
        )
        jdbc.update(
            """
            INSERT INTO workspace.workspace_memberships (id, workspace_id, user_id, role, created_at)
            VALUES (?, ?, ?, 'OWNER', ?)
            """.trimIndent(),
            UUID.randomUUID(),
            request.workspaceId,
            request.ownerUserId,
            timestamp,
        )
        return request.workspaceId
    }
}
