package ai.taskpilot.coreapi.project.internal

import ai.taskpilot.coreapi.project.BoardColumnView
import ai.taskpilot.coreapi.project.BoardDeleteRestricted
import ai.taskpilot.coreapi.project.BoardNameConfirmationMismatch
import ai.taskpilot.coreapi.project.BoardNotEmptyConflict
import ai.taskpilot.coreapi.project.BoardSummary
import ai.taskpilot.coreapi.project.BoardVersionConflict
import ai.taskpilot.coreapi.project.BoardView
import ai.taskpilot.coreapi.project.CardView
import ai.taskpilot.coreapi.project.ColumnNotEmptyConflict
import ai.taskpilot.coreapi.project.CreateBoardCommand
import ai.taskpilot.coreapi.project.CreateColumnCommand
import ai.taskpilot.coreapi.project.CreateWorkItemCommand
import ai.taskpilot.coreapi.project.CreateWorkItemResult
import ai.taskpilot.coreapi.project.DeleteBoardCommand
import ai.taskpilot.coreapi.project.DeleteColumnCommand
import ai.taskpilot.coreapi.project.EditBoardCommand
import ai.taskpilot.coreapi.project.EditColumnCommand
import ai.taskpilot.coreapi.project.EditWorkItemCommand
import ai.taskpilot.coreapi.project.EditWorkItemResult
import ai.taskpilot.coreapi.project.LastColumnConflict
import ai.taskpilot.coreapi.project.MovePlacementCommand
import ai.taskpilot.coreapi.project.PlacementConflict
import ai.taskpilot.coreapi.project.ProjectResourceVersionConflict
import ai.taskpilot.coreapi.project.ProjectWorkIdempotencyConflict
import ai.taskpilot.coreapi.project.ProjectWorkNotFound
import ai.taskpilot.coreapi.project.ProjectWorkUseCases
import ai.taskpilot.coreapi.project.ProjectWorkValidationFailed
import ai.taskpilot.coreapi.project.ReorderColumnsCommand
import ai.taskpilot.coreapi.project.WorkItemView
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.ResultSet
import java.text.Normalizer
import java.time.Clock
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource

@Suppress("TooManyFunctions", "LargeClass")
class ProjectWorkApplicationService(
    dataSource: DataSource,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) : ProjectWorkUseCases {
    private val jdbc = JdbcTemplate(dataSource)
    private val transactions = TransactionTemplate(transactionManager)

    override fun listBoards(
        actorUserId: UUID,
        workspaceId: UUID,
        projectId: UUID,
    ): List<BoardSummary> {
        requireProjectOwner(actorUserId, workspaceId, projectId)
        return jdbc.query(
            """
            SELECT b.id, b.project_id, b.name, b.description, b.version, b.created_at, b.updated_at
            FROM project.boards b
            WHERE b.project_id = ?
            ORDER BY b.created_at, b.id
            """.trimIndent(),
            { rows, _ -> rows.toBoardSummary() },
            projectId,
        )
    }

    override fun board(
        actorUserId: UUID,
        workspaceId: UUID,
        projectId: UUID,
        boardId: UUID,
    ): BoardView {
        requireProjectOwner(actorUserId, workspaceId, projectId)
        return loadBoard(projectId, boardId) ?: throw ProjectWorkNotFound()
    }

    override fun createBoard(command: CreateBoardCommand): BoardView {
        val input = normalizeBoard(command.name, command.description, command.locale)
        val fingerprint = fingerprint(input.name, input.description, input.locale)
        return inTransaction {
            requireProjectOwner(command.actorUserId, command.workspaceId, command.projectId)
            findBoardCreate(command.projectId, command.actorUserId, command.requestId)?.let {
                if (it.second != fingerprint) throw ProjectWorkIdempotencyConflict()
                return@inTransaction loadBoard(command.projectId, it.first) ?: error("Created board is missing")
            }
            val boardId = UUID.randomUUID()
            val columnId = UUID.randomUUID()
            val timestamp = now()
            val inserted =
                jdbc.update(
                    """
                    INSERT INTO project.boards (
                        id, project_id, name, description, version, created_by_user_id,
                        create_request_id, create_request_fingerprint, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
                    ON CONFLICT (project_id, created_by_user_id, create_request_id) DO NOTHING
                    """.trimIndent(),
                    boardId,
                    command.projectId,
                    input.name,
                    input.description,
                    command.actorUserId,
                    command.requestId,
                    fingerprint,
                    timestamp,
                    timestamp,
                )
            if (inserted == 1) {
                jdbc.update(
                    """
                    INSERT INTO project.board_columns (
                        id, project_id, board_id, name, position, version, created_by_user_id,
                        create_request_id, create_request_fingerprint, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
                    """.trimIndent(),
                    columnId,
                    command.projectId,
                    boardId,
                    initialColumnName(input.locale),
                    command.actorUserId,
                    command.requestId,
                    fingerprint("initial-column", boardId.toString(), input.locale),
                    timestamp,
                    timestamp,
                )
            }
            val persisted =
                findBoardCreate(command.projectId, command.actorUserId, command.requestId)
                    ?: error("Created board request is missing")
            if (persisted.second != fingerprint) throw ProjectWorkIdempotencyConflict()
            loadBoard(command.projectId, persisted.first) ?: error("Created board is missing")
        }
    }

    override fun editBoard(command: EditBoardCommand): BoardView {
        validateExpected(command.expectedVersion, "expectedVersion")
        val input = normalizeBoard(command.name, command.description, null)
        return inTransaction {
            requireProjectOwner(command.actorUserId, command.workspaceId, command.projectId)
            requireBoardForUpdate(command.projectId, command.boardId, command.expectedVersion)
            jdbc.update(
                """UPDATE project.boards SET name = ?, description = ?, version = version + 1, updated_at = ?
                   WHERE id = ? AND project_id = ?""",
                input.name,
                input.description,
                now(),
                command.boardId,
                command.projectId,
            )
            loadBoard(command.projectId, command.boardId) ?: error("Updated board is missing")
        }
    }

    override fun createColumn(command: CreateColumnCommand): BoardView {
        validateExpected(command.expectedBoardVersion, "expectedBoardVersion")
        val name = normalizeRequired(command.name, COLUMN_NAME_MAX_CODE_POINTS, "name")
        val fp = fingerprint(command.boardId.toString(), name)
        return inTransaction {
            requireProjectOwner(command.actorUserId, command.workspaceId, command.projectId)
            findColumnCreate(command.projectId, command.actorUserId, command.requestId)?.let {
                if (it.second != fp) throw ProjectWorkIdempotencyConflict()
                return@inTransaction loadBoard(command.projectId, command.boardId) ?: throw ProjectWorkNotFound()
            }
            val lockedVersion = lockBoardVersion(command.projectId, command.boardId)
            findColumnCreate(command.projectId, command.actorUserId, command.requestId)?.let {
                if (it.second != fp) throw ProjectWorkIdempotencyConflict()
                return@inTransaction loadBoard(command.projectId, command.boardId) ?: throw ProjectWorkNotFound()
            }
            if (lockedVersion != command.expectedBoardVersion) throw BoardVersionConflict()
            val position = nextColumnPosition(command.projectId, command.boardId)
            val timestamp = now()
            jdbc.update(
                """
                INSERT INTO project.board_columns (
                    id, project_id, board_id, name, position, version, created_by_user_id,
                    create_request_id, create_request_fingerprint, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
                """.trimIndent(),
                UUID.randomUUID(),
                command.projectId,
                command.boardId,
                name,
                position,
                command.actorUserId,
                command.requestId,
                fp,
                timestamp,
                timestamp,
            )
            incrementBoard(command.projectId, command.boardId)
            loadBoard(command.projectId, command.boardId) ?: error("Updated board is missing")
        }
    }

    override fun editColumn(command: EditColumnCommand): BoardView {
        validateExpected(command.expectedBoardVersion, "expectedBoardVersion")
        validateExpected(command.expectedColumnVersion, "expectedColumnVersion")
        val name = normalizeRequired(command.name, COLUMN_NAME_MAX_CODE_POINTS, "name")
        return inTransaction {
            requireProjectOwner(command.actorUserId, command.workspaceId, command.projectId)
            requireBoardForUpdate(command.projectId, command.boardId, command.expectedBoardVersion)
            val changed =
                jdbc.update(
                    """UPDATE project.board_columns SET name = ?, version = version + 1, updated_at = ?
                   WHERE id = ? AND project_id = ? AND board_id = ? AND version = ?""",
                    name,
                    now(),
                    command.columnId,
                    command.projectId,
                    command.boardId,
                    command.expectedColumnVersion,
                )
            if (changed != 1) {
                if (!columnExists(command.projectId, command.boardId, command.columnId)) throw ProjectWorkNotFound()
                throw ProjectResourceVersionConflict()
            }
            incrementBoard(command.projectId, command.boardId)
            loadBoard(command.projectId, command.boardId) ?: error("Updated board is missing")
        }
    }

    override fun reorderColumns(command: ReorderColumnsCommand): BoardView {
        validateExpected(command.expectedBoardVersion, "expectedBoardVersion")
        return inTransaction {
            requireProjectOwner(command.actorUserId, command.workspaceId, command.projectId)
            requireBoardForUpdate(command.projectId, command.boardId, command.expectedBoardVersion)
            val current = columnIds(command.projectId, command.boardId)
            if (command.columnIds.size != current.size || command.columnIds.toSet().size != current.size ||
                command.columnIds.toSet() != current.toSet()
            ) {
                throw ProjectWorkValidationFailed("columnIds")
            }
            if (current == command.columnIds) return@inTransaction loadBoard(command.projectId, command.boardId)!!
            deferOrderingConstraints()
            command.columnIds.forEachIndexed { index, id ->
                jdbc.update(
                    """UPDATE project.board_columns SET position = ?, version = version + 1, updated_at = ?
                       WHERE id = ? AND project_id = ? AND board_id = ?""",
                    position(index),
                    now(),
                    id,
                    command.projectId,
                    command.boardId,
                )
            }
            incrementBoard(command.projectId, command.boardId)
            loadBoard(command.projectId, command.boardId)!!
        }
    }

    override fun deleteColumn(command: DeleteColumnCommand) {
        validateExpected(command.expectedBoardVersion, "expectedBoardVersion")
        validateExpected(command.expectedColumnVersion, "expectedColumnVersion")
        inTransaction {
            requireProjectOwner(command.actorUserId, command.workspaceId, command.projectId)
            requireBoardForUpdate(command.projectId, command.boardId, command.expectedBoardVersion)
            val columns = columnIds(command.projectId, command.boardId)
            if (command.columnId !in columns) throw ProjectWorkNotFound()
            if (columns.size == 1) throw LastColumnConflict()
            if (jdbc.queryForObject(
                    "SELECT count(*) FROM project.board_placements WHERE project_id = ? AND board_id = ? AND column_id = ?",
                    Int::class.java,
                    command.projectId,
                    command.boardId,
                    command.columnId,
                ) != 0
            ) {
                throw ColumnNotEmptyConflict()
            }
            val deleted =
                jdbc.update(
                    "DELETE FROM project.board_columns WHERE id = ? AND project_id = ? AND board_id = ? AND version = ?",
                    command.columnId,
                    command.projectId,
                    command.boardId,
                    command.expectedColumnVersion,
                )
            if (deleted != 1) throw ProjectResourceVersionConflict()
            reorderColumnsInternal(command.projectId, command.boardId, columns.filterNot { it == command.columnId })
            incrementBoard(command.projectId, command.boardId)
        }
    }

    override fun permanentlyDeleteBoard(command: DeleteBoardCommand) {
        validateExpected(command.expectedVersion, "expectedVersion")
        inTransaction {
            requireProjectOwner(command.actorUserId, command.workspaceId, command.projectId)
            val locked = lockBoardForDeletion(command.projectId, command.boardId)
            if (locked.version != command.expectedVersion) throw BoardVersionConflict()
            if (locked.name != command.confirmationName) throw BoardNameConfirmationMismatch()
            if (placementCount(command.projectId, command.boardId) != 0) throw BoardNotEmptyConflict()
            try {
                jdbc.update(
                    "DELETE FROM project.board_columns WHERE project_id = ? AND board_id = ?",
                    command.projectId,
                    command.boardId,
                )
                val deleted =
                    jdbc.update(
                        "DELETE FROM project.boards WHERE project_id = ? AND id = ?",
                        command.projectId,
                        command.boardId,
                    )
                if (deleted != 1) throw ProjectWorkNotFound()
            } catch (failure: DataIntegrityViolationException) {
                throw BoardDeleteRestricted().apply { addSuppressed(failure) }
            }
        }
    }

    override fun createWorkItem(command: CreateWorkItemCommand): CreateWorkItemResult {
        validateExpected(command.expectedBoardVersion, "expectedBoardVersion")
        val input = normalizeWorkItem(command.title, command.description)
        val fp =
            fingerprint(
                input.title,
                input.description,
                command.boardId.toString(),
                command.columnId.toString(),
                command.expectedBoardVersion.toString(),
            )
        return inTransaction {
            requireProjectOwner(command.actorUserId, command.workspaceId, command.projectId)
            findWorkItemCreate(command.projectId, command.actorUserId, command.requestId)?.let {
                if (it.second != fp) throw ProjectWorkIdempotencyConflict()
                val item = loadWorkItem(command.projectId, it.first) ?: error("Created work item is missing")
                return@inTransaction CreateWorkItemResult(
                    item,
                    loadBoard(command.projectId, command.boardId) ?: throw ProjectWorkNotFound(),
                )
            }
            val lockedVersion = lockBoardVersion(command.projectId, command.boardId)
            findWorkItemCreate(command.projectId, command.actorUserId, command.requestId)?.let {
                if (it.second != fp) throw ProjectWorkIdempotencyConflict()
                val item = loadWorkItem(command.projectId, it.first) ?: error("Created work item is missing")
                return@inTransaction CreateWorkItemResult(
                    item,
                    loadBoard(command.projectId, command.boardId) ?: throw ProjectWorkNotFound(),
                )
            }
            if (lockedVersion != command.expectedBoardVersion) throw BoardVersionConflict()
            if (!columnExists(command.projectId, command.boardId, command.columnId)) throw ProjectWorkNotFound()
            persistWorkItem(command, input, fp)
        }
    }

    private fun persistWorkItem(
        command: CreateWorkItemCommand,
        input: WorkItemInput,
        fingerprint: String,
    ): CreateWorkItemResult {
        val workItemId = UUID.randomUUID()
        val timestamp = now()
        jdbc.update(
            """
            INSERT INTO project.work_items (
                id, project_id, title, description, version, created_by_user_id,
                create_request_id, create_request_fingerprint, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
            """.trimIndent(),
            workItemId,
            command.projectId,
            input.title,
            input.description,
            command.actorUserId,
            command.requestId,
            fingerprint,
            timestamp,
            timestamp,
        )
        jdbc.update(
            """INSERT INTO project.board_placements
               (id, project_id, board_id, column_id, work_item_id, position, version, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)""",
            UUID.randomUUID(),
            command.projectId,
            command.boardId,
            command.columnId,
            workItemId,
            nextPlacementPosition(command.projectId, command.boardId, command.columnId),
            timestamp,
            timestamp,
        )
        incrementBoard(command.projectId, command.boardId)
        return CreateWorkItemResult(
            loadWorkItem(command.projectId, workItemId)!!,
            loadBoard(command.projectId, command.boardId)!!,
        )
    }

    override fun workItem(
        actorUserId: UUID,
        workspaceId: UUID,
        projectId: UUID,
        workItemId: UUID,
    ): WorkItemView {
        requireProjectOwner(actorUserId, workspaceId, projectId)
        return loadWorkItem(projectId, workItemId) ?: throw ProjectWorkNotFound()
    }

    override fun editWorkItem(command: EditWorkItemCommand): EditWorkItemResult {
        validateExpected(command.expectedVersion, "expectedVersion")
        val expectedLayoutVersions = expectedLayoutVersions(command)
        val changesColumn = expectedLayoutVersions != null
        val input = normalizeWorkItem(command.title, command.description)
        return inTransaction {
            requireProjectOwner(command.actorUserId, command.workspaceId, command.projectId)
            if (expectedLayoutVersions != null) {
                requireBoardForUpdate(command.projectId, command.boardId, expectedLayoutVersions.first)
                if (!columnExists(command.projectId, command.boardId, command.targetColumnId)) throw ProjectWorkNotFound()
            }
            val moving = placement(command.projectId, command.boardId, command.workItemId) ?: throw ProjectWorkNotFound()
            if (moving.columnId != command.currentColumnId) throw ProjectWorkNotFound()
            if (expectedLayoutVersions != null && moving.version != expectedLayoutVersions.second) {
                throw ProjectResourceVersionConflict()
            }
            val changed =
                jdbc.update(
                    """UPDATE project.work_items SET title = ?, description = ?, version = version + 1, updated_at = ?
                   WHERE id = ? AND project_id = ? AND version = ?""",
                    input.title,
                    input.description,
                    now(),
                    command.workItemId,
                    command.projectId,
                    command.expectedVersion,
                )
            if (changed != 1) {
                if (loadWorkItem(command.projectId, command.workItemId) == null) throw ProjectWorkNotFound()
                throw ProjectResourceVersionConflict()
            }
            if (changesColumn) {
                val sourceIds =
                    placementIds(command.projectId, command.boardId, command.currentColumnId)
                        .filterNot { it == command.workItemId }
                val targetIds =
                    placementIds(command.projectId, command.boardId, command.targetColumnId).toMutableList()
                targetIds.add(command.workItemId)
                deferOrderingConstraints()
                reorderPlacements(command.projectId, command.boardId, command.currentColumnId, sourceIds)
                reorderPlacements(command.projectId, command.boardId, command.targetColumnId, targetIds)
                incrementBoard(command.projectId, command.boardId)
            }
            EditWorkItemResult(
                loadWorkItem(command.projectId, command.workItemId)!!,
                loadBoard(command.projectId, command.boardId)!!,
            )
        }
    }

    override fun movePlacement(command: MovePlacementCommand): BoardView {
        validateExpected(command.expectedBoardVersion, "expectedBoardVersion")
        validateExpected(command.expectedPlacementVersion, "expectedPlacementVersion")
        return inTransaction {
            requireProjectOwner(command.actorUserId, command.workspaceId, command.projectId)
            requireBoardForUpdate(command.projectId, command.boardId, command.expectedBoardVersion)
            if (!columnExists(command.projectId, command.boardId, command.targetColumnId)) throw ProjectWorkNotFound()
            val moving = placement(command.projectId, command.boardId, command.workItemId) ?: throw ProjectWorkNotFound()
            if (moving.version != command.expectedPlacementVersion) throw ProjectResourceVersionConflict()
            val sourceIds = placementIds(command.projectId, command.boardId, moving.columnId).filterNot { it == command.workItemId }
            val targetIds =
                if (moving.columnId == command.targetColumnId) {
                    sourceIds.toMutableList()
                } else {
                    placementIds(command.projectId, command.boardId, command.targetColumnId).toMutableList()
                }
            val targetIndex =
                command.beforeWorkItemId?.let { anchor ->
                    targetIds.indexOf(anchor).takeIf { it >= 0 } ?: throw PlacementConflict()
                } ?: targetIds.size
            targetIds.add(targetIndex, command.workItemId)
            val currentTarget = placementIds(command.projectId, command.boardId, command.targetColumnId)
            if (moving.columnId == command.targetColumnId && currentTarget == targetIds) {
                return@inTransaction loadBoard(command.projectId, command.boardId)!!
            }
            deferOrderingConstraints()
            if (moving.columnId != command.targetColumnId) reorderPlacements(command.projectId, command.boardId, moving.columnId, sourceIds)
            reorderPlacements(command.projectId, command.boardId, command.targetColumnId, targetIds)
            incrementBoard(command.projectId, command.boardId)
            loadBoard(command.projectId, command.boardId)!!
        }
    }

    private fun requireProjectOwner(
        actor: UUID,
        workspace: UUID,
        project: UUID,
    ) {
        if (jdbc.queryForObject(
                """SELECT count(*) FROM project.projects p
                   JOIN project.project_memberships m ON m.project_id = p.id AND m.user_id = ? AND m.role = 'OWNER'
                   JOIN access.users u ON u.id = m.user_id AND u.status = 'ACTIVE'
                   WHERE p.id = ? AND p.workspace_id = ?""",
                Int::class.java,
                actor,
                project,
                workspace,
            ) != 1
        ) {
            throw ProjectWorkNotFound()
        }
    }

    private fun requireBoardForUpdate(
        projectId: UUID,
        boardId: UUID,
        expectedVersion: Long,
    ) {
        if (lockBoardVersion(projectId, boardId) != expectedVersion) throw BoardVersionConflict()
    }

    private fun lockBoardVersion(
        projectId: UUID,
        boardId: UUID,
    ): Long =
        jdbc
            .query(
                "SELECT version FROM project.boards WHERE id = ? AND project_id = ? FOR UPDATE",
                { r, _ -> r.getLong(1) },
                boardId,
                projectId,
            ).singleOrNull()
            ?: throw ProjectWorkNotFound()

    private fun lockBoardForDeletion(
        projectId: UUID,
        boardId: UUID,
    ): LockedBoard =
        jdbc
            .query(
                "SELECT version, name FROM project.boards WHERE id = ? AND project_id = ? FOR UPDATE",
                { rows, _ -> LockedBoard(rows.getLong("version"), rows.getString("name")) },
                boardId,
                projectId,
            ).singleOrNull()
            ?: throw ProjectWorkNotFound()

    private fun placementCount(
        projectId: UUID,
        boardId: UUID,
    ): Int =
        requireNotNull(
            jdbc.queryForObject(
                "SELECT count(*) FROM project.board_placements WHERE project_id = ? AND board_id = ?",
                Int::class.java,
                projectId,
                boardId,
            ),
        )

    private fun loadBoard(
        projectId: UUID,
        boardId: UUID,
    ): BoardView? {
        val summary =
            jdbc
                .query(
                    """SELECT id, project_id, name, description, version, created_at, updated_at
               FROM project.boards WHERE id = ? AND project_id = ?""",
                    { r, _ -> r.toBoardSummary() },
                    boardId,
                    projectId,
                ).singleOrNull() ?: return null
        val columns =
            jdbc.query(
                """SELECT id, name, position, version, created_at, updated_at
               FROM project.board_columns WHERE project_id = ? AND board_id = ? ORDER BY position, id""",
                { r, _ ->
                    val columnId = r.uuid("id")
                    BoardColumnView(
                        columnId,
                        r.getString("name"),
                        r.getLong("position"),
                        r.getLong("version"),
                        r.instant("created_at"),
                        r.instant("updated_at"),
                        loadCards(projectId, boardId, columnId),
                    )
                },
                projectId,
                boardId,
            )
        return BoardView(
            summary.boardId,
            summary.projectId,
            summary.name,
            summary.description,
            summary.version,
            summary.createdAt,
            summary.updatedAt,
            columns,
        )
    }

    private fun loadCards(
        projectId: UUID,
        boardId: UUID,
        columnId: UUID,
    ): List<CardView> =
        jdbc.query(
            """SELECT w.id, w.title, w.description, w.version AS work_item_version,
                  p.version AS placement_version, p.position
           FROM project.board_placements p
           JOIN project.work_items w ON w.project_id = p.project_id AND w.id = p.work_item_id
           WHERE p.project_id = ? AND p.board_id = ? AND p.column_id = ?
           ORDER BY p.position, p.id""",
            {
                r,
                _,
                ->
                CardView(
                    r.uuid("id"),
                    r.getString("title"),
                    r.getString("description"),
                    r.getLong("work_item_version"),
                    r.getLong("placement_version"),
                    r.getLong("position"),
                )
            },
            projectId,
            boardId,
            columnId,
        )

    private fun loadWorkItem(
        projectId: UUID,
        workItemId: UUID,
    ): WorkItemView? =
        jdbc
            .query(
                """SELECT id, project_id, title, description, version, created_at, updated_at
           FROM project.work_items WHERE id = ? AND project_id = ?""",
                {
                    r,
                    _,
                    ->
                    WorkItemView(
                        r.uuid("id"),
                        r.uuid("project_id"),
                        r.getString("title"),
                        r.getString("description"),
                        r.getLong("version"),
                        r.instant("created_at"),
                        r.instant("updated_at"),
                    )
                },
                workItemId,
                projectId,
            ).singleOrNull()

    private fun findBoardCreate(
        project: UUID,
        actor: UUID,
        request: UUID,
    ): Pair<UUID, String>? =
        jdbc
            .query(
                """
                SELECT id, create_request_fingerprint FROM project.boards
                WHERE project_id = ? AND created_by_user_id = ? AND create_request_id = ?
                """.trimIndent(),
                { r, _ -> r.uuid("id") to r.getString("create_request_fingerprint") },
                project,
                actor,
                request,
            ).singleOrNull()

    private fun findColumnCreate(
        project: UUID,
        actor: UUID,
        request: UUID,
    ): Pair<UUID, String>? =
        jdbc
            .query(
                """
                SELECT board_id, create_request_fingerprint FROM project.board_columns
                WHERE project_id = ? AND created_by_user_id = ? AND create_request_id = ?
                """.trimIndent(),
                { r, _ -> r.uuid("board_id") to r.getString("create_request_fingerprint") },
                project,
                actor,
                request,
            ).singleOrNull()

    private fun findWorkItemCreate(
        project: UUID,
        actor: UUID,
        request: UUID,
    ): Pair<UUID, String>? =
        jdbc
            .query(
                """
                SELECT id, create_request_fingerprint FROM project.work_items
                WHERE project_id = ? AND created_by_user_id = ? AND create_request_id = ?
                """.trimIndent(),
                { r, _ -> r.uuid("id") to r.getString("create_request_fingerprint") },
                project,
                actor,
                request,
            ).singleOrNull()

    private fun columnExists(
        project: UUID,
        board: UUID,
        column: UUID,
    ): Boolean =
        jdbc.queryForObject(
            "SELECT count(*) FROM project.board_columns WHERE project_id = ? AND board_id = ? AND id = ?",
            Int::class.java,
            project,
            board,
            column,
        ) == 1

    private fun columnIds(
        project: UUID,
        board: UUID,
    ): List<UUID> =
        jdbc.query(
            "SELECT id FROM project.board_columns WHERE project_id = ? AND board_id = ? ORDER BY position, id",
            { r, _ -> r.uuid("id") },
            project,
            board,
        )

    private fun placementIds(
        project: UUID,
        board: UUID,
        column: UUID,
    ): List<UUID> =
        jdbc.query(
            """
            SELECT work_item_id FROM project.board_placements
            WHERE project_id = ? AND board_id = ? AND column_id = ?
            ORDER BY position, id
            """.trimIndent(),
            { r, _ -> r.uuid("work_item_id") },
            project,
            board,
            column,
        )

    private fun placement(
        project: UUID,
        board: UUID,
        workItem: UUID,
    ): PlacementRow? =
        jdbc
            .query(
                """
                SELECT column_id, version FROM project.board_placements
                WHERE project_id = ? AND board_id = ? AND work_item_id = ?
                FOR UPDATE
                """.trimIndent(),
                { r, _ -> PlacementRow(r.uuid("column_id"), r.getLong("version")) },
                project,
                board,
                workItem,
            ).singleOrNull()

    private fun reorderColumnsInternal(
        project: UUID,
        board: UUID,
        ids: List<UUID>,
    ) {
        deferOrderingConstraints()
        ids.forEachIndexed {
            index,
            id,
            ->
            jdbc.update(
                """UPDATE project.board_columns SET position = ?,
                   version = version + CASE WHEN position <> ? THEN 1 ELSE 0 END,
                   updated_at = CASE WHEN position <> ? THEN ? ELSE updated_at END
                   WHERE project_id = ? AND board_id = ? AND id = ?""",
                position(index),
                position(index),
                position(index),
                now(),
                project,
                board,
                id,
            )
        }
    }

    private fun reorderPlacements(
        project: UUID,
        board: UUID,
        column: UUID,
        ids: List<UUID>,
    ) {
        ids.forEachIndexed { index, id ->
            jdbc.update(
                """UPDATE project.board_placements SET column_id = ?, position = ?,
                   version = version + CASE WHEN column_id <> ? OR position <> ? THEN 1 ELSE 0 END,
                   updated_at = CASE WHEN column_id <> ? OR position <> ? THEN ? ELSE updated_at END
                   WHERE project_id = ? AND board_id = ? AND work_item_id = ?""",
                column,
                position(index),
                column,
                position(index),
                column,
                position(index),
                now(),
                project,
                board,
                id,
            )
        }
    }

    private fun nextColumnPosition(
        project: UUID,
        board: UUID,
    ): Long =
        jdbc.queryForObject(
            "SELECT COALESCE(max(position) + ?, 0) FROM project.board_columns WHERE project_id = ? AND board_id = ?",
            Long::class.java,
            POSITION_STEP,
            project,
            board,
        )!!

    private fun nextPlacementPosition(
        project: UUID,
        board: UUID,
        column: UUID,
    ): Long =
        jdbc.queryForObject(
            "SELECT COALESCE(max(position) + ?, 0) FROM project.board_placements WHERE project_id = ? AND board_id = ? AND column_id = ?",
            Long::class.java,
            POSITION_STEP,
            project,
            board,
            column,
        )!!

    private fun incrementBoard(
        project: UUID,
        board: UUID,
    ) {
        jdbc.update(
            "UPDATE project.boards SET version = version + 1, updated_at = ? WHERE project_id = ? AND id = ?",
            now(),
            project,
            board,
        )
    }

    private fun normalizeBoard(
        name: String,
        description: String?,
        locale: String?,
    ): BoardInput {
        val normalizedLocale = locale?.also { if (it !in SUPPORTED_LOCALES) throw ProjectWorkValidationFailed("locale") }
        return BoardInput(
            normalizeRequired(name, BOARD_NAME_MAX_CODE_POINTS, "name"),
            normalizeOptional(description, BOARD_DESCRIPTION_MAX_CODE_POINTS, "description"),
            normalizedLocale,
        )
    }

    private fun normalizeWorkItem(
        title: String,
        description: String?,
    ) = WorkItemInput(
        normalizeRequired(title, WORK_ITEM_TITLE_MAX_CODE_POINTS, "title"),
        normalizeOptional(description, WORK_ITEM_DESCRIPTION_MAX_CODE_POINTS, "description"),
    )

    private fun normalizeRequired(
        value: String,
        maximum: Int,
        path: String,
    ): String =
        normalizeText(value).also {
            if (it.codePointCount(0, it.length) !in 1..maximum) throw ProjectWorkValidationFailed(path)
        }

    private fun normalizeOptional(
        value: String?,
        maximum: Int,
        path: String,
    ): String =
        normalizeText(value.orEmpty()).also {
            if (it.codePointCount(0, it.length) > maximum) throw ProjectWorkValidationFailed(path)
        }

    private fun expectedLayoutVersions(command: EditWorkItemCommand): Pair<Long, Long>? {
        command.expectedBoardVersion?.let { validateExpected(it, "expectedBoardVersion") }
        command.expectedPlacementVersion?.let { validateExpected(it, "expectedPlacementVersion") }
        if (command.currentColumnId == command.targetColumnId) return null
        return Pair(
            command.expectedBoardVersion ?: throw ProjectWorkValidationFailed("expectedBoardVersion"),
            command.expectedPlacementVersion ?: throw ProjectWorkValidationFailed("expectedPlacementVersion"),
        )
    }

    private fun normalizeText(value: String) = Normalizer.normalize(value.trim(), Normalizer.Form.NFC)

    private fun initialColumnName(locale: String?) =
        when (locale) {
            "zh-CN" -> "待处理"
            "en" -> "To do"
            else -> throw ProjectWorkValidationFailed("locale")
        }

    private fun validateExpected(
        value: Long,
        path: String,
    ) {
        if (value < 0) throw ProjectWorkValidationFailed(path)
    }

    private fun fingerprint(vararg values: String?): String {
        val canonical =
            values.joinToString("") { value ->
                val actual = value.orEmpty()
                "${actual.length}:$actual"
            }
        return MessageDigest
            .getInstance(
                "SHA-256",
            ).digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun deferOrderingConstraints() =
        jdbc.execute("SET CONSTRAINTS project.uq_board_columns__board_position, project.uq_board_placements__column_position DEFERRED")

    private fun now() = clock.instant().atOffset(ZoneOffset.UTC)

    private fun position(index: Int) = index.toLong() * POSITION_STEP

    private fun <T> inTransaction(action: () -> T): T = requireNotNull(transactions.execute { action() })

    private fun ResultSet.uuid(name: String): UUID = getObject(name, UUID::class.java)

    private fun ResultSet.instant(name: String) = getObject(name, OffsetDateTime::class.java).toInstant()

    private fun ResultSet.toBoardSummary() =
        BoardSummary(
            uuid("id"),
            uuid("project_id"),
            getString("name"),
            getString("description"),
            getLong("version"),
            instant("created_at"),
            instant("updated_at"),
        )

    private data class BoardInput(
        val name: String,
        val description: String,
        val locale: String?,
    )

    private data class LockedBoard(
        val version: Long,
        val name: String,
    )

    private data class WorkItemInput(
        val title: String,
        val description: String,
    )

    private data class PlacementRow(
        val columnId: UUID,
        val version: Long,
    )

    private companion object {
        const val POSITION_STEP = 1024L
        const val COLUMN_NAME_MAX_CODE_POINTS = 80
        const val BOARD_NAME_MAX_CODE_POINTS = 120
        const val BOARD_DESCRIPTION_MAX_CODE_POINTS = 2_000
        const val WORK_ITEM_TITLE_MAX_CODE_POINTS = 300
        const val WORK_ITEM_DESCRIPTION_MAX_CODE_POINTS = 10_000
        val SUPPORTED_LOCALES = setOf("zh-CN", "en")
    }
}
