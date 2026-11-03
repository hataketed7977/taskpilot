package ai.taskpilot.coreapi.project.internal

import ai.taskpilot.coreapi.project.BoardScope
import ai.taskpilot.coreapi.project.ColumnScope
import ai.taskpilot.coreapi.project.ProjectNotFound
import ai.taskpilot.coreapi.project.ProjectResourceScope
import ai.taskpilot.coreapi.project.ProjectScope
import ai.taskpilot.coreapi.project.ProjectWorkNotFound
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID
import javax.sql.DataSource

class JdbcProjectResourceScope(
    dataSource: DataSource,
) : ProjectResourceScope {
    private val jdbc = JdbcTemplate(dataSource)

    override fun project(projectId: UUID): ProjectScope =
        jdbc
            .query(
                "SELECT workspace_id FROM project.projects WHERE id = ?",
                { row, _ -> ProjectScope(row.getObject("workspace_id", UUID::class.java), projectId) },
                projectId,
            ).singleOrNull() ?: throw ProjectNotFound()

    override fun board(boardId: UUID): BoardScope =
        jdbc
            .query(
                """SELECT p.workspace_id, b.project_id FROM project.boards b
               JOIN project.projects p ON p.id = b.project_id WHERE b.id = ?""",
                {
                    row,
                    _,
                    ->
                    BoardScope(row.getObject("workspace_id", UUID::class.java), row.getObject("project_id", UUID::class.java), boardId)
                },
                boardId,
            ).singleOrNull() ?: throw ProjectWorkNotFound()

    override fun column(columnId: UUID): ColumnScope =
        jdbc
            .query(
                """SELECT p.workspace_id, c.project_id, c.board_id FROM project.board_columns c
               JOIN project.projects p ON p.id = c.project_id WHERE c.id = ?""",
                {
                    row,
                    _,
                    ->
                    ColumnScope(
                        row.getObject("workspace_id", UUID::class.java),
                        row.getObject("project_id", UUID::class.java),
                        row.getObject("board_id", UUID::class.java),
                        columnId,
                    )
                },
                columnId,
            ).singleOrNull() ?: throw ProjectWorkNotFound()

    override fun workItem(workItemId: UUID): ProjectScope =
        jdbc
            .query(
                """SELECT p.workspace_id, w.project_id FROM project.work_items w
               JOIN project.projects p ON p.id = w.project_id WHERE w.id = ?""",
                { row, _ -> ProjectScope(row.getObject("workspace_id", UUID::class.java), row.getObject("project_id", UUID::class.java)) },
                workItemId,
            ).singleOrNull() ?: throw ProjectWorkNotFound()
}
