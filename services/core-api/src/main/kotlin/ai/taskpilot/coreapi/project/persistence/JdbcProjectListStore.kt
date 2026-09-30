package ai.taskpilot.coreapi.project.persistence

import ai.taskpilot.coreapi.project.application.ProjectListStore
import ai.taskpilot.coreapi.project.application.ProjectListStoreUnavailableException
import ai.taskpilot.coreapi.project.model.ProjectId
import ai.taskpilot.coreapi.project.model.ProjectSummary
import org.springframework.dao.DataAccessException
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID
import javax.sql.DataSource

class JdbcProjectListStore(
    dataSource: DataSource,
) : ProjectListStore {
    private val jdbc = JdbcTemplate(dataSource)

    override fun list(
        actor: UUID,
        workspaceId: UUID,
        afterProjectId: UUID?,
        limit: Int,
    ): List<ProjectSummary> =
        try {
            jdbc.query(
                """
                SELECT p.project_id, p.workspace_id, p.name
                FROM projects p
                JOIN project_memberships pm
                  ON pm.project_id = p.project_id AND pm.workspace_id = p.workspace_id
                WHERE pm.user_id = ? AND pm.workspace_id = ?
                  AND (?::uuid IS NULL OR p.project_id > ?::uuid)
                ORDER BY p.project_id
                LIMIT ?
                """.trimIndent(),
                { rows, _ ->
                    ProjectSummary(
                        ProjectId(rows.getObject("project_id", UUID::class.java)),
                        rows.getObject("workspace_id", UUID::class.java),
                        rows.getString("name"),
                    )
                },
                actor,
                workspaceId,
                afterProjectId,
                afterProjectId,
                limit,
            )
        } catch (failure: DataAccessException) {
            throw ProjectListStoreUnavailableException(failure)
        }
}
