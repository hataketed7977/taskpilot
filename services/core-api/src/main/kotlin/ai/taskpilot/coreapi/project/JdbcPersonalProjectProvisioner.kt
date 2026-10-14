package ai.taskpilot.coreapi.project

import org.springframework.jdbc.core.JdbcTemplate
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource

class JdbcPersonalProjectProvisioner(
    dataSource: DataSource,
) : PersonalProjectProvisioner {
    private val jdbc = JdbcTemplate(dataSource)

    override fun provisionDefaultProject(request: DefaultProjectProvisioningRequest): UUID {
        val timestamp = request.now.atOffset(ZoneOffset.UTC)
        jdbc.update(
            """
            INSERT INTO project.projects (
                id, workspace_id, name, description, status, version, created_by_user_id,
                create_request_id, create_request_fingerprint, created_at, updated_at, archived_at
            ) VALUES (?, ?, ?, '', 'ACTIVE', 0, ?, ?, 'onboarding-default-v1', ?, ?, NULL)
            """.trimIndent(),
            request.projectId,
            request.workspaceId,
            request.name,
            request.ownerUserId,
            request.projectId,
            timestamp,
            timestamp,
        )
        jdbc.update(
            """
            INSERT INTO project.project_memberships (id, project_id, user_id, role, created_at)
            VALUES (?, ?, ?, 'OWNER', ?)
            """.trimIndent(),
            UUID.randomUUID(),
            request.projectId,
            request.ownerUserId,
            timestamp,
        )
        return request.projectId
    }
}
