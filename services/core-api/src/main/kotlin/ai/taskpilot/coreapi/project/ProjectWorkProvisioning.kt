package ai.taskpilot.coreapi.project

import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

internal object ProjectWorkProvisioning {
    fun initialNames(locale: String): Pair<String, String> =
        when (locale) {
            "zh-CN" -> "工作看板" to "待处理"
            "en" -> "Board" to "To do"
            else -> throw ProjectValidationFailed("locale")
        }

    fun insertInitialBoard(
        jdbc: JdbcTemplate,
        projectId: UUID,
        ownerUserId: UUID,
        locale: String,
        now: Instant,
    ): UUID {
        val (boardName, columnName) = initialNames(locale)
        val boardId = UUID.randomUUID()
        val columnId = UUID.randomUUID()
        val timestamp = now.atOffset(ZoneOffset.UTC)
        jdbc.update(
            """
            INSERT INTO project.boards (
                id, project_id, name, description, version, created_by_user_id,
                create_request_id, create_request_fingerprint, created_at, updated_at
            ) VALUES (?, ?, ?, '', 0, ?, ?, ?, ?, ?)
            """.trimIndent(),
            boardId,
            projectId,
            boardName,
            ownerUserId,
            boardId,
            "initial-board-v1:$locale",
            timestamp,
            timestamp,
        )
        jdbc.update(
            """
            INSERT INTO project.board_columns (
                id, project_id, board_id, name, position, version, created_by_user_id,
                create_request_id, create_request_fingerprint, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
            """.trimIndent(),
            columnId,
            projectId,
            boardId,
            columnName,
            ownerUserId,
            columnId,
            "initial-column-v1:$locale",
            timestamp,
            timestamp,
        )
        return boardId
    }
}
