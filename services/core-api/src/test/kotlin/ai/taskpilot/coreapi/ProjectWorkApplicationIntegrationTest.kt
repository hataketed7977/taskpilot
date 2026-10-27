package ai.taskpilot.coreapi

import ai.taskpilot.coreapi.project.BoardDeleteRestricted
import ai.taskpilot.coreapi.project.BoardNameConfirmationMismatch
import ai.taskpilot.coreapi.project.BoardNotEmptyConflict
import ai.taskpilot.coreapi.project.BoardVersionConflict
import ai.taskpilot.coreapi.project.BoardView
import ai.taskpilot.coreapi.project.ColumnNotEmptyConflict
import ai.taskpilot.coreapi.project.CreateBoardCommand
import ai.taskpilot.coreapi.project.CreateColumnCommand
import ai.taskpilot.coreapi.project.CreateProjectCommand
import ai.taskpilot.coreapi.project.CreateWorkItemCommand
import ai.taskpilot.coreapi.project.DeleteBoardCommand
import ai.taskpilot.coreapi.project.DeleteColumnCommand
import ai.taskpilot.coreapi.project.DeleteProjectCommand
import ai.taskpilot.coreapi.project.EditBoardCommand
import ai.taskpilot.coreapi.project.EditColumnCommand
import ai.taskpilot.coreapi.project.EditWorkItemCommand
import ai.taskpilot.coreapi.project.LastColumnConflict
import ai.taskpilot.coreapi.project.MovePlacementCommand
import ai.taskpilot.coreapi.project.PlacementConflict
import ai.taskpilot.coreapi.project.ProjectResourceVersionConflict
import ai.taskpilot.coreapi.project.ProjectWorkIdempotencyConflict
import ai.taskpilot.coreapi.project.ProjectWorkNotFound
import ai.taskpilot.coreapi.project.ProjectWorkValidationFailed
import ai.taskpilot.coreapi.project.ReorderColumnsCommand
import ai.taskpilot.coreapi.project.internal.ProjectApplicationService
import ai.taskpilot.coreapi.project.internal.ProjectWorkApplicationService
import ai.taskpilot.coreapi.workspace.WorkspaceAccessQuery
import ai.taskpilot.coreapi.workspace.WorkspaceRole
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.postgresql.PostgreSQLContainer
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@Suppress("LargeClass") // One PostgreSQL fixture exercises the complete Project Work application boundary.
class ProjectWorkApplicationIntegrationTest {
    private lateinit var postgres: PostgreSQLContainer
    private lateinit var dataSource: DataSource
    private lateinit var jdbc: JdbcTemplate
    private lateinit var projects: ProjectApplicationService
    private lateinit var work: ProjectWorkApplicationService
    private val now = Instant.parse("2026-10-15T00:00:00Z")

    @BeforeAll fun start() {
        postgres = PostgreSQLContainer("postgres:17-alpine").also { it.start() }
        dataSource = DriverManagerDataSource(postgres.jdbcUrl, postgres.username, postgres.password)
        Flyway
            .configure()
            .dataSource(dataSource)
            .locations("classpath:db/migration")
            .load()
            .migrate()
        jdbc = JdbcTemplate(dataSource)
        val tx = DataSourceTransactionManager(dataSource)
        val access = JdbcWorkspaceAccessQuery(dataSource)
        projects = ProjectApplicationService(dataSource, access, Clock.fixed(now, ZoneOffset.UTC), tx)
        work = ProjectWorkApplicationService(dataSource, Clock.fixed(now, ZoneOffset.UTC), tx)
    }

    @AfterAll fun stop() = postgres.stop()

    @BeforeEach fun reset() =
        jdbc.execute(
            "TRUNCATE project.board_placements, project.board_columns, project.work_items, project.boards, " +
                "project.project_memberships, project.projects, workspace.workspace_memberships, workspace.workspaces, " +
                "access.terms_acceptances, access.external_identities, access.users CASCADE",
        )

    @Test fun `project and board provisioning localize ordinary initial data`() {
        val (owner, workspace) = fixtureAccount()
        val project = projects.create(CreateProjectCommand(owner, workspace, UUID.randomUUID(), "Project", null, "zh-CN"))
        val initial = work.listBoards(owner, workspace, project.projectId).single()
        assertEquals("工作看板", initial.name)
        assertEquals(
            "待处理",
            work
                .board(owner, workspace, project.projectId, initial.boardId)
                .columns
                .single()
                .name,
        )

        val request = UUID.randomUUID()
        val board = work.createBoard(CreateBoardCommand(owner, workspace, project.projectId, request, " Delivery ", " Notes ", "en"))
        val replay = work.createBoard(CreateBoardCommand(owner, workspace, project.projectId, request, "Delivery", "Notes", "en"))
        assertEquals(board.boardId, replay.boardId)
        assertEquals("To do", board.columns.single().name)
        assertFailsWith<ProjectWorkIdempotencyConflict> {
            work.createBoard(CreateBoardCommand(owner, workspace, project.projectId, request, "Changed", "Notes", "en"))
        }
    }

    @Test fun `concurrent board request replay creates one board and initial column`() {
        val f = fixtureProject()
        val requestId = UUID.randomUUID()
        val command = CreateBoardCommand(f.owner, f.workspace, f.project, requestId, "Concurrent", null, "en")

        val results = concurrently { work.createBoard(command) }

        assertEquals(1, results.map { it.boardId }.distinct().size)
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM project.boards WHERE project_id = ?", Int::class.java, f.project))
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT count(*) FROM project.board_columns WHERE project_id = ? AND board_id = ?",
                Int::class.java,
                f.project,
                results.first().boardId,
            ),
        )
    }

    @Test fun `concurrent column request replay creates one column and increments board once`() {
        val f = fixtureProject()
        val requestId = UUID.randomUUID()
        val command = CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, requestId, 0, "Concurrent")

        val results = concurrently { work.createColumn(command) }

        assertEquals(
            1,
            results
                .flatMap { it.columns }
                .filter { it.name == "Concurrent" }
                .map { it.columnId }
                .distinct()
                .size,
        )
        val board = work.board(f.owner, f.workspace, f.project, f.board.boardId)
        assertEquals(2, board.columns.size)
        assertEquals(1, board.version)
    }

    @Test fun `concurrent work item request replay creates one item and placement and increments board once`() {
        val f = fixtureProject()
        val requestId = UUID.randomUUID()
        val command =
            CreateWorkItemCommand(
                f.owner,
                f.workspace,
                f.project,
                f.board.boardId,
                f.board.columns
                    .single()
                    .columnId,
                requestId,
                0,
                "Concurrent",
                null,
            )

        val results = concurrently { work.createWorkItem(command) }

        assertEquals(1, results.map { it.workItem.workItemId }.distinct().size)
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM project.work_items WHERE project_id = ?", Int::class.java, f.project))
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT count(*) FROM project.board_placements WHERE board_id = ?",
                Int::class.java,
                f.board.boardId,
            ),
        )
        assertEquals(1, work.board(f.owner, f.workspace, f.project, f.board.boardId).version)
    }

    @Test fun `column invariants and deterministic ordering are transactional`() {
        val f = fixtureProject()
        val initial = f.board.columns.single()
        assertFailsWith<LastColumnConflict> {
            work.deleteColumn(DeleteColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, initial.columnId, 0, 0))
        }
        val second = work.createColumn(CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 0, "Doing"))
        assertEquals(1, second.version)
        val reordered =
            work
                .reorderColumns(
                    ReorderColumnsCommand(
                        f.owner,
                        f.workspace,
                        f.project,
                        f.board.boardId,
                        1,
                        second.columns.reversed().map {
                            it.columnId
                        },
                    ),
                )
        assertEquals(listOf("Doing", "To do"), reordered.columns.map { it.name })
        work.deleteColumn(
            DeleteColumnCommand(
                f.owner,
                f.workspace,
                f.project,
                f.board.boardId,
                initial.columnId,
                2,
                reordered.columns.single { it.columnId == initial.columnId }.version,
            ),
        )
        assertEquals(listOf("Doing"), work.board(f.owner, f.workspace, f.project, f.board.boardId).columns.map { it.name })
    }

    @Test fun `deleting a column increments only versions of columns whose position changes`() {
        val f = fixtureProject()
        val first = f.board.columns.single()
        val withSecond =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 0, "Doing"),
            )
        val withThird =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 1, "Done"),
            )
        val second = withThird.columns.single { it.name == "Doing" }
        val third = withThird.columns.single { it.name == "Done" }

        work.deleteColumn(
            DeleteColumnCommand(
                f.owner,
                f.workspace,
                f.project,
                f.board.boardId,
                second.columnId,
                2,
                second.version,
            ),
        )

        val after = work.board(f.owner, f.workspace, f.project, f.board.boardId)
        assertEquals(listOf(first.columnId, third.columnId), after.columns.map { it.columnId })
        assertEquals(first.version, after.columns.single { it.columnId == first.columnId }.version)
        assertEquals(third.version + 1, after.columns.single { it.columnId == third.columnId }.version)
    }

    @Test fun `work item create replay edit and move preserve authority and versions`() {
        val f = fixtureProject()
        val firstColumn = f.board.columns.single()
        val withSecond =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 0, "Done"),
            )
        val secondColumn = withSecond.columns.last()
        val request = UUID.randomUUID()
        val created =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    firstColumn.columnId,
                    request,
                    1,
                    " Task ",
                    " Detail ",
                ),
            )
        assertEquals(
            setOf("workItemId", "projectId", "title", "description", "version", "createdAt", "updatedAt"),
            created.workItem.javaClass.declaredFields
                .map { it.name }
                .toSet(),
        )
        assertEquals(2, created.board.version)
        val replay =
            work.createWorkItem(
                CreateWorkItemCommand(f.owner, f.workspace, f.project, f.board.boardId, firstColumn.columnId, request, 1, "Task", "Detail"),
            )
        assertEquals(created.workItem.workItemId, replay.workItem.workItemId)
        assertFailsWith<ProjectWorkIdempotencyConflict> {
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    firstColumn.columnId,
                    request,
                    1,
                    "Changed",
                    "Detail",
                ),
            )
        }
        assertFailsWith<BoardVersionConflict> {
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    firstColumn.columnId,
                    UUID.randomUUID(),
                    1,
                    "Stale",
                    null,
                ),
            )
        }
        val moved =
            work.movePlacement(
                MovePlacementCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    created.workItem.workItemId,
                    2,
                    0,
                    secondColumn.columnId,
                    null,
                ),
            )
        assertEquals(
            listOf(created.workItem.workItemId),
            moved.columns
                .last()
                .cards
                .map { it.workItemId },
        )
        assertEquals("Task", work.workItem(f.owner, f.workspace, f.project, created.workItem.workItemId).title)
        val edited =
            work.editWorkItem(
                EditWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    created.workItem.workItemId,
                    f.board.boardId,
                    secondColumn.columnId,
                    secondColumn.columnId,
                    3,
                    1,
                    0,
                    "Updated",
                    null,
                ),
            )
        assertEquals("Updated", edited.workItem.title)
        assertEquals(
            "Updated",
            work
                .board(f.owner, f.workspace, f.project, f.board.boardId)
                .columns
                .last()
                .cards
                .single()
                .title,
        )
        assertFailsWith<ColumnNotEmptyConflict> {
            work.deleteColumn(DeleteColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, secondColumn.columnId, 3, 0))
        }
    }

    @Test fun `board column and placement conflicts keep authoritative versions`() {
        val f = fixtureProject()
        val editedBoard =
            work.editBoard(
                EditBoardCommand(f.owner, f.workspace, f.project, f.board.boardId, 0, "Planning", "Updated"),
            )
        assertEquals(1, editedBoard.version)

        val requestId = UUID.randomUUID()
        val withSecond =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, requestId, 1, "Doing"),
            )
        val second = withSecond.columns.last()
        val replay =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, requestId, 1, "Doing"),
            )
        assertEquals(second.columnId, replay.columns.last().columnId)
        assertFailsWith<ProjectWorkIdempotencyConflict> {
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, requestId, 1, "Changed"),
            )
        }

        val renamed =
            work.editColumn(
                EditColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, second.columnId, 2, 0, "In progress"),
            )
        assertEquals(3, renamed.version)
        assertFailsWith<ProjectResourceVersionConflict> {
            work.editColumn(
                EditColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, second.columnId, 3, 0, "Stale"),
            )
        }
        assertFailsWith<ProjectWorkNotFound> {
            work.editColumn(
                EditColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 3, 0, "Missing"),
            )
        }
        assertEquals(
            3,
            work
                .reorderColumns(
                    ReorderColumnsCommand(f.owner, f.workspace, f.project, f.board.boardId, 3, renamed.columns.map { it.columnId }),
                ).version,
        )
        assertFailsWith<ProjectWorkValidationFailed> {
            work.reorderColumns(
                ReorderColumnsCommand(f.owner, f.workspace, f.project, f.board.boardId, 3, listOf(second.columnId)),
            )
        }

        val firstColumn = renamed.columns.first()
        val created =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    firstColumn.columnId,
                    UUID.randomUUID(),
                    3,
                    "Task",
                    null,
                ),
            )
        val unchanged =
            work.movePlacement(
                MovePlacementCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    created.workItem.workItemId,
                    4,
                    0,
                    firstColumn.columnId,
                    null,
                ),
            )
        assertEquals(4, unchanged.version)
        assertFailsWith<PlacementConflict> {
            work.movePlacement(
                MovePlacementCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    created.workItem.workItemId,
                    4,
                    0,
                    second.columnId,
                    UUID.randomUUID(),
                ),
            )
        }
        val moved =
            work.movePlacement(
                MovePlacementCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    created.workItem.workItemId,
                    4,
                    0,
                    second.columnId,
                    null,
                ),
            )
        assertEquals(5, moved.version)
        assertFailsWith<ProjectResourceVersionConflict> {
            work.movePlacement(
                MovePlacementCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    created.workItem.workItemId,
                    5,
                    0,
                    firstColumn.columnId,
                    null,
                ),
            )
        }
    }

    @Test fun `one work item projects authoritative content into multiple boards and moves independently`() {
        val f = fixtureProject()
        val secondBoard =
            work.createBoard(
                CreateBoardCommand(f.owner, f.workspace, f.project, UUID.randomUUID(), "Second", null, "en"),
            )
        val created =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    f.board.columns
                        .single()
                        .columnId,
                    UUID.randomUUID(),
                    0,
                    "Shared",
                    "Original",
                ),
            )
        val timestamp = now.atOffset(ZoneOffset.UTC)
        jdbc.update(
            """INSERT INTO project.board_placements
               (id, project_id, board_id, column_id, work_item_id, position, version, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)""",
            UUID.randomUUID(),
            f.project,
            secondBoard.boardId,
            secondBoard.columns.single().columnId,
            created.workItem.workItemId,
            timestamp,
            timestamp,
        )

        work.editWorkItem(
            EditWorkItemCommand(
                f.owner,
                f.workspace,
                f.project,
                created.workItem.workItemId,
                f.board.boardId,
                f.board
                    .columns
                    .single()
                    .columnId,
                f.board
                    .columns
                    .single()
                    .columnId,
                1,
                0,
                0,
                "Updated",
                "Authoritative",
            ),
        )
        assertEquals(
            "Updated",
            work
                .board(f.owner, f.workspace, f.project, f.board.boardId)
                .columns
                .single()
                .cards
                .single()
                .title,
        )
        assertEquals(
            "Updated",
            work
                .board(f.owner, f.workspace, f.project, secondBoard.boardId)
                .columns
                .single()
                .cards
                .single()
                .title,
        )

        val expanded =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 1, "Done"),
            )
        work.movePlacement(
            MovePlacementCommand(
                f.owner,
                f.workspace,
                f.project,
                f.board.boardId,
                created.workItem.workItemId,
                2,
                0,
                expanded.columns.last().columnId,
                null,
            ),
        )
        val untouched = work.board(f.owner, f.workspace, f.project, secondBoard.boardId)
        assertEquals(0, untouched.version)
        assertEquals(secondBoard.columns.single().columnId, untouched.columns.single().columnId)
        assertEquals(
            created.workItem.workItemId,
            untouched.columns
                .single()
                .cards
                .single()
                .workItemId,
        )
    }

    @Test fun `editing in the same column changes content without changing layout versions`() {
        val f = fixtureProject()
        val column = f.board.columns.single()
        val created =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    column.columnId,
                    UUID.randomUUID(),
                    0,
                    "Original",
                    null,
                ),
            )

        val edited =
            work.editWorkItem(
                EditWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    created.workItem.workItemId,
                    f.board.boardId,
                    column.columnId,
                    column.columnId,
                    null,
                    null,
                    0,
                    "Updated",
                    "Detail",
                ),
            )

        assertEquals("Updated", edited.workItem.title)
        assertEquals(1, edited.workItem.version)
        assertEquals(1, edited.board.version)
        assertEquals(
            0,
            edited.board
                .columns
                .single()
                .cards
                .single()
                .placementVersion,
        )
    }

    @Test fun `editing into another column atomically updates content and appends placement`() {
        val f = fixtureProject()
        val expanded =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 0, "Doing"),
            )
        val source = expanded.columns.first()
        val target = expanded.columns.last()
        val existingTarget =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    target.columnId,
                    UUID.randomUUID(),
                    1,
                    "Existing",
                    null,
                ),
            )
        val moving =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    source.columnId,
                    UUID.randomUUID(),
                    2,
                    "Original",
                    null,
                ),
            )

        val edited =
            work.editWorkItem(
                EditWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    moving.workItem.workItemId,
                    f.board.boardId,
                    source.columnId,
                    target.columnId,
                    3,
                    0,
                    0,
                    "Updated and moved",
                    null,
                ),
            )

        assertEquals("Updated and moved", edited.workItem.title)
        assertEquals(4, edited.board.version)
        assertEquals(
            listOf(existingTarget.workItem.workItemId, moving.workItem.workItemId),
            edited.board
                .columns
                .last()
                .cards
                .map { it.workItemId },
        )
        assertEquals(
            1,
            edited.board
                .columns
                .last()
                .cards
                .last()
                .placementVersion,
        )
    }

    @Test fun `failed atomic edit keeps both work item and placement unchanged`() {
        val f = fixtureProject()
        val expanded =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 0, "Doing"),
            )
        val source = expanded.columns.first()
        val target = expanded.columns.last()
        val created =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    source.columnId,
                    UUID.randomUUID(),
                    1,
                    "Original",
                    null,
                ),
            )
        val stale =
            EditWorkItemCommand(
                f.owner,
                f.workspace,
                f.project,
                created.workItem.workItemId,
                f.board.boardId,
                source.columnId,
                target.columnId,
                1,
                0,
                0,
                "Must roll back",
                null,
            )

        assertFailsWith<ProjectWorkValidationFailed> {
            work.editWorkItem(stale.copy(expectedBoardVersion = null))
        }.also { assertEquals("expectedBoardVersion", it.path) }
        assertAtomicEditDidNotChangeContentOrPlacement(f, created.workItem.workItemId, source.columnId, target.columnId)

        assertFailsWith<ProjectWorkValidationFailed> {
            work.editWorkItem(stale.copy(expectedPlacementVersion = null))
        }.also { assertEquals("expectedPlacementVersion", it.path) }
        assertAtomicEditDidNotChangeContentOrPlacement(f, created.workItem.workItemId, source.columnId, target.columnId)

        assertFailsWith<BoardVersionConflict> { work.editWorkItem(stale) }
        val afterConflict = work.board(f.owner, f.workspace, f.project, f.board.boardId)
        assertEquals("Original", work.workItem(f.owner, f.workspace, f.project, created.workItem.workItemId).title)
        assertEquals(
            listOf(created.workItem.workItemId),
            afterConflict.columns
                .first()
                .cards
                .map { it.workItemId },
        )
        assertEquals(
            emptyList(),
            afterConflict.columns
                .last()
                .cards
                .map { it.workItemId },
        )

        assertFailsWith<ProjectWorkNotFound> {
            work.editWorkItem(stale.copy(expectedBoardVersion = 2, targetColumnId = UUID.randomUUID()))
        }
        assertAtomicEditDidNotChangeContentOrPlacement(f, created.workItem.workItemId, source.columnId, target.columnId)

        assertFailsWith<ProjectResourceVersionConflict> {
            work.editWorkItem(stale.copy(expectedBoardVersion = 2, expectedVersion = 1))
        }
        assertAtomicEditDidNotChangeContentOrPlacement(f, created.workItem.workItemId, source.columnId, target.columnId)

        assertFailsWith<ProjectResourceVersionConflict> {
            work.editWorkItem(stale.copy(expectedBoardVersion = 2, expectedPlacementVersion = 1))
        }
        assertAtomicEditDidNotChangeContentOrPlacement(f, created.workItem.workItemId, source.columnId, target.columnId)
    }

    private fun assertAtomicEditDidNotChangeContentOrPlacement(
        fixture: Fixture,
        workItemId: UUID,
        sourceColumnId: UUID,
        targetColumnId: UUID,
    ) {
        assertEquals("Original", work.workItem(fixture.owner, fixture.workspace, fixture.project, workItemId).title)
        val board = work.board(fixture.owner, fixture.workspace, fixture.project, fixture.board.boardId)
        assertEquals(2, board.version)
        assertEquals(
            listOf(workItemId),
            board.columns
                .single { it.columnId == sourceColumnId }
                .cards
                .map { it.workItemId },
        )
        assertEquals(
            emptyList(),
            board.columns
                .single { it.columnId == targetColumnId }
                .cards
                .map { it.workItemId },
        )
    }

    @Test fun `concurrent placement moves serialize on board version and preserve one authoritative layout`() {
        val f = fixtureProject()
        work.createColumn(
            CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 0, "Second"),
        )
        val withThird =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 1, "Third"),
            )
        val created =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    withThird.columns.first().columnId,
                    UUID.randomUUID(),
                    2,
                    "Contended",
                    null,
                ),
            )
        val commands =
            withThird.columns.drop(1).map { target ->
                MovePlacementCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    created.workItem.workItemId,
                    3,
                    0,
                    target.columnId,
                    null,
                )
            }

        val results = concurrentlyIndexed(commands) { command -> runCatching { work.movePlacement(command) } }

        assertEquals(1, results.count { it.isSuccess })
        assertEquals(1, results.count { it.exceptionOrNull() is BoardVersionConflict })
        val authoritative = work.board(f.owner, f.workspace, f.project, f.board.boardId)
        assertEquals(4, authoritative.version)
        assertEquals(1, authoritative.columns.sumOf { it.cards.size })
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT count(*) FROM project.board_placements WHERE board_id = ?",
                Int::class.java,
                f.board.boardId,
            ),
        )
    }

    @Test fun `project work validates normalized input before persistence`() {
        val f = fixtureProject()
        assertFailsWith<ProjectWorkValidationFailed> {
            work.createBoard(CreateBoardCommand(f.owner, f.workspace, f.project, UUID.randomUUID(), " ", null, "en"))
        }
        assertFailsWith<ProjectWorkValidationFailed> {
            work.createBoard(CreateBoardCommand(f.owner, f.workspace, f.project, UUID.randomUUID(), "Board", null, "fr"))
        }
        assertFailsWith<ProjectWorkValidationFailed> {
            work.editBoard(EditBoardCommand(f.owner, f.workspace, f.project, f.board.boardId, -1, "Board", null))
        }
        assertFailsWith<ProjectWorkValidationFailed> {
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, f.board.boardId, UUID.randomUUID(), 0, "x".repeat(81)),
            )
        }
    }

    @Test fun `project work normalizes persisted text and idempotency fingerprints to NFC`() {
        val f = fixtureProject()
        val requestId = UUID.randomUUID()
        val decomposed = " Cafe\u0301 "
        val composed = "Café"

        val created = work.createBoard(CreateBoardCommand(f.owner, f.workspace, f.project, requestId, decomposed, decomposed, "en"))
        val replayed = work.createBoard(CreateBoardCommand(f.owner, f.workspace, f.project, requestId, composed, composed, "en"))
        val column =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, created.boardId, UUID.randomUUID(), 0, decomposed),
            )
        val item =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    created.boardId,
                    column.columns.last().columnId,
                    UUID.randomUUID(),
                    1,
                    decomposed,
                    decomposed,
                ),
            )

        assertEquals(created.boardId, replayed.boardId)
        assertEquals(composed, created.name)
        assertEquals(composed, created.description)
        assertEquals(composed, column.columns.last().name)
        assertEquals(composed, item.workItem.title)
        assertEquals(composed, item.workItem.description)
    }

    @Test fun `empty board permanent deletion removes columns and preserves project work items`() {
        val f = fixtureProject()
        val itemResult =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    f.board.columns
                        .single()
                        .columnId,
                    UUID.randomUUID(),
                    0,
                    "Keep me",
                    null,
                ),
            )
        val item = itemResult.workItem
        val removable =
            work.createBoard(
                CreateBoardCommand(f.owner, f.workspace, f.project, UUID.randomUUID(), "Removable", null, "en"),
            )
        work.createColumn(
            CreateColumnCommand(f.owner, f.workspace, f.project, removable.boardId, UUID.randomUUID(), 0, "Done"),
        )
        val withThreeColumns =
            work.createColumn(
                CreateColumnCommand(f.owner, f.workspace, f.project, removable.boardId, UUID.randomUUID(), 1, "Archive"),
            )

        work.permanentlyDeleteBoard(
            DeleteBoardCommand(f.owner, f.workspace, f.project, removable.boardId, withThreeColumns.version, "Removable"),
        )

        assertEquals(listOf(f.board.boardId), work.listBoards(f.owner, f.workspace, f.project).map { it.boardId })
        assertEquals(item.workItemId, work.workItem(f.owner, f.workspace, f.project, item.workItemId).workItemId)
        assertEquals(
            0,
            jdbc.queryForObject(
                "SELECT count(*) FROM project.board_columns WHERE project_id = ? AND board_id = ?",
                Int::class.java,
                f.project,
                removable.boardId,
            ),
        )
    }

    @Test fun `board permanent deletion rejects non empty stale mismatched and cross scope requests atomically`() {
        val f = fixtureProject()
        val item =
            work.createWorkItem(
                CreateWorkItemCommand(
                    f.owner,
                    f.workspace,
                    f.project,
                    f.board.boardId,
                    f.board.columns
                        .single()
                        .columnId,
                    UUID.randomUUID(),
                    0,
                    "Placed",
                    null,
                ),
            )
        assertFailsWith<BoardNotEmptyConflict> {
            work.permanentlyDeleteBoard(
                DeleteBoardCommand(f.owner, f.workspace, f.project, f.board.boardId, item.board.version, "Board"),
            )
        }

        val empty =
            work.createBoard(CreateBoardCommand(f.owner, f.workspace, f.project, UUID.randomUUID(), "Empty", null, "en"))
        assertFailsWith<BoardVersionConflict> {
            work.permanentlyDeleteBoard(DeleteBoardCommand(f.owner, f.workspace, f.project, empty.boardId, 1, "Empty"))
        }
        assertFailsWith<BoardNameConfirmationMismatch> {
            work.permanentlyDeleteBoard(DeleteBoardCommand(f.owner, f.workspace, f.project, empty.boardId, 0, " empty "))
        }

        val other = fixtureProject()
        assertFailsWith<ProjectWorkNotFound> {
            work.permanentlyDeleteBoard(DeleteBoardCommand(f.owner, f.workspace, f.project, other.board.boardId, 0, "Project board"))
        }
        assertFailsWith<ProjectWorkNotFound> {
            work.permanentlyDeleteBoard(DeleteBoardCommand(other.owner, f.workspace, f.project, empty.boardId, 0, "Empty"))
        }

        assertEquals(
            2,
            jdbc.queryForObject("SELECT count(*) FROM project.boards WHERE project_id = ?", Int::class.java, f.project),
        )
        assertEquals(
            2,
            jdbc.queryForObject("SELECT count(*) FROM project.board_columns WHERE project_id = ?", Int::class.java, f.project),
        )
        assertEquals(
            1,
            jdbc.queryForObject("SELECT count(*) FROM project.board_placements WHERE project_id = ?", Int::class.java, f.project),
        )
    }

    @Test fun `board permanent deletion maps protected dependencies and rolls back column deletion`() {
        val f = fixtureProject()
        val empty =
            work.createBoard(CreateBoardCommand(f.owner, f.workspace, f.project, UUID.randomUUID(), "Protected", null, "en"))
        jdbc.execute(
            """
            CREATE TABLE project.board_delete_test_guards (
                board_id UUID PRIMARY KEY REFERENCES project.boards(id) ON DELETE RESTRICT
            )
            """.trimIndent(),
        )
        try {
            jdbc.update("INSERT INTO project.board_delete_test_guards (board_id) VALUES (?)", empty.boardId)

            assertFailsWith<BoardDeleteRestricted> {
                work.permanentlyDeleteBoard(DeleteBoardCommand(f.owner, f.workspace, f.project, empty.boardId, 0, "Protected"))
            }

            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM project.boards WHERE id = ?", Int::class.java, empty.boardId))
            assertEquals(
                1,
                jdbc.queryForObject("SELECT count(*) FROM project.board_columns WHERE board_id = ?", Int::class.java, empty.boardId),
            )
        } finally {
            jdbc.execute("DROP TABLE project.board_delete_test_guards")
        }
    }

    @Test fun `cross scope ids are not found and project deletion removes approved subtree`() {
        val first = fixtureProject()
        val second = fixtureProject()
        assertFailsWith<ProjectWorkNotFound> { work.board(first.owner, first.workspace, first.project, second.board.boardId) }
        work.createWorkItem(
            CreateWorkItemCommand(
                first.owner,
                first.workspace,
                first.project,
                first.board.boardId,
                first.board.columns
                    .single()
                    .columnId,
                UUID.randomUUID(),
                0,
                "Task",
                null,
            ),
        )
        projects.permanentlyDelete(DeleteProjectCommand(first.owner, first.workspace, first.project, 0, "Project"))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM project.boards WHERE project_id = ?", Int::class.java, first.project))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM project.work_items WHERE project_id = ?", Int::class.java, first.project))
    }

    private fun <I, T> concurrentlyIndexed(
        inputs: List<I>,
        action: (I) -> T,
    ): List<T> {
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(inputs.size)
        return try {
            val futures =
                inputs.map { input ->
                    pool.submit(
                        Callable {
                            start.await(5, TimeUnit.SECONDS)
                            action(input)
                        },
                    )
                }
            start.countDown()
            futures.map { it.get(10, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }
    }

    private fun <T> concurrently(action: () -> T): List<T> {
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        return try {
            val futures =
                (1..2).map {
                    pool.submit(
                        Callable {
                            start.await(5, TimeUnit.SECONDS)
                            action()
                        },
                    )
                }
            start.countDown()
            futures.map { it.get(10, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }
    }

    private fun fixtureProject(): Fixture {
        val (owner, workspace) = fixtureAccount()
        val project = projects.create(CreateProjectCommand(owner, workspace, UUID.randomUUID(), "Project", null, "en"))
        val board = work.board(owner, workspace, project.projectId, work.listBoards(owner, workspace, project.projectId).single().boardId)
        return Fixture(owner, workspace, project.projectId, board)
    }

    private fun fixtureAccount(): Pair<UUID, UUID> {
        val owner = UUID.randomUUID()
        val workspace = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO access.users (id, display_name, status, created_at) VALUES (?, 'Owner', 'ACTIVE', ?)",
            owner,
            now.atOffset(ZoneOffset.UTC),
        )
        jdbc.update(
            "INSERT INTO workspace.workspaces (id, type, personal_owner_user_id, created_at, updated_at) VALUES (?, 'PERSONAL', ?, ?, ?)",
            workspace,
            owner,
            now.atOffset(ZoneOffset.UTC),
            now.atOffset(ZoneOffset.UTC),
        )
        jdbc.update(
            "INSERT INTO workspace.workspace_memberships (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'OWNER', ?)",
            UUID.randomUUID(),
            workspace,
            owner,
            now.atOffset(ZoneOffset.UTC),
        )
        return owner to workspace
    }

    private data class Fixture(
        val owner: UUID,
        val workspace: UUID,
        val project: UUID,
        val board: BoardView,
    )

    private class JdbcWorkspaceAccessQuery(
        dataSource: DataSource,
    ) : WorkspaceAccessQuery {
        private val jdbc = JdbcTemplate(dataSource)

        override fun roleFor(
            userId: UUID,
            workspaceId: UUID,
        ): WorkspaceRole? =
            jdbc
                .query(
                    """
                    SELECT role FROM workspace.workspace_memberships m
                    JOIN access.users u ON u.id=m.user_id AND u.status='ACTIVE'
                    WHERE m.user_id=? AND m.workspace_id=?
                    """.trimIndent(),
                    { r, _ -> WorkspaceRole.valueOf(r.getString(1)) },
                    userId,
                    workspaceId,
                ).singleOrNull()
    }
}
