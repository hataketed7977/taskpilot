package ai.taskpilot.coreapi.project.internal

import ai.taskpilot.coreapi.project.CreateProjectCommand
import ai.taskpilot.coreapi.project.DeleteProjectCommand
import ai.taskpilot.coreapi.project.EditProjectCommand
import ai.taskpilot.coreapi.project.ProjectDeleteRestricted
import ai.taskpilot.coreapi.project.ProjectIdempotencyConflict
import ai.taskpilot.coreapi.project.ProjectNameConfirmationMismatch
import ai.taskpilot.coreapi.project.ProjectNotFound
import ai.taskpilot.coreapi.project.ProjectPage
import ai.taskpilot.coreapi.project.ProjectStatus
import ai.taskpilot.coreapi.project.ProjectStatusCommand
import ai.taskpilot.coreapi.project.ProjectUseCases
import ai.taskpilot.coreapi.project.ProjectValidationFailed
import ai.taskpilot.coreapi.project.ProjectVersionConflict
import ai.taskpilot.coreapi.project.ProjectView
import ai.taskpilot.coreapi.project.WorkspaceNotFound
import ai.taskpilot.coreapi.workspace.WorkspaceAccessQuery
import ai.taskpilot.coreapi.workspace.WorkspaceRole
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import javax.sql.DataSource

@Suppress("TooManyFunctions") // One application service implements the cohesive ProjectUseCases contract.
class ProjectApplicationService(
    dataSource: DataSource,
    private val workspaceAccess: WorkspaceAccessQuery,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) : ProjectUseCases {
    private val jdbc = JdbcTemplate(dataSource)
    private val transactions = TransactionTemplate(transactionManager)

    @Suppress("SpreadOperator") // JdbcTemplate's typed query overload accepts positional arguments only as varargs.
    override fun list(
        actorUserId: UUID,
        workspaceId: UUID,
        status: ProjectStatus,
        limit: Int,
        cursor: String?,
    ): ProjectPage {
        requireWorkspaceOwner(actorUserId, workspaceId)
        if (limit !in MINIMUM_LIMIT..MAXIMUM_LIMIT) throw ProjectValidationFailed("limit")
        val position = cursor?.let { ProjectCursor.decode(it, workspaceId, status) }
        val parameters = mutableListOf<Any>(workspaceId, status.name)
        val cursorPredicate =
            if (position == null) {
                ""
            } else {
                parameters += position.createdAt.atOffset(ZoneOffset.UTC)
                parameters += position.createdAt.atOffset(ZoneOffset.UTC)
                parameters += position.projectId
                "AND (p.created_at > ? OR (p.created_at = ? AND p.id > ?))"
            }
        parameters += limit + 1
        val projects =
            jdbc.query(
                """
                SELECT p.id, p.workspace_id, p.name, p.description, p.status, p.version,
                       p.created_at, p.updated_at, p.archived_at
                FROM project.projects p
                JOIN project.project_memberships m
                  ON m.project_id = p.id AND m.user_id = ? AND m.role = 'OWNER'
                WHERE p.workspace_id = ? AND p.status = ?
                $cursorPredicate
                ORDER BY p.created_at, p.id
                LIMIT ?
                """.trimIndent(),
                PROJECT_ROW_MAPPER,
                actorUserId,
                *parameters.toTypedArray(),
            )
        val items = projects.take(limit)
        val next =
            if (projects.size > limit) {
                items.last().let { ProjectCursor.encode(workspaceId, status, it.createdAt, it.projectId) }
            } else {
                null
            }
        return ProjectPage(items, next)
    }

    override fun detail(
        actorUserId: UUID,
        workspaceId: UUID,
        projectId: UUID,
    ): ProjectView {
        requireWorkspaceOwner(actorUserId, workspaceId)
        return findAuthorizedProject(actorUserId, workspaceId, projectId) ?: throw ProjectNotFound()
    }

    override fun create(command: CreateProjectCommand): ProjectView {
        requireWorkspaceOwner(command.actorUserId, command.workspaceId)
        val input = normalizedInput(command.name, command.description)
        val locale = normalizedLocale(command.locale)
        val fingerprint = fingerprint(input, locale)
        return requireNotNull(
            transactions.execute {
                val projectId = UUID.randomUUID()
                val timestamp = clock.instant().atOffset(ZoneOffset.UTC)
                val inserted =
                    jdbc.update(
                        """
                        INSERT INTO project.projects (
                            id, workspace_id, name, description, status, version, created_by_user_id,
                            create_request_id, create_request_fingerprint, created_at, updated_at, archived_at
                        ) VALUES (?, ?, ?, ?, 'ACTIVE', 0, ?, ?, ?, ?, ?, NULL)
                        ON CONFLICT (workspace_id, created_by_user_id, create_request_id) DO NOTHING
                        """.trimIndent(),
                        projectId,
                        command.workspaceId,
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
                        INSERT INTO project.project_memberships (id, project_id, user_id, role, created_at)
                        VALUES (?, ?, ?, 'OWNER', ?)
                        """.trimIndent(),
                        UUID.randomUUID(),
                        projectId,
                        command.actorUserId,
                        timestamp,
                    )
                    ai.taskpilot.coreapi.project.ProjectWorkProvisioning.insertInitialBoard(
                        jdbc,
                        projectId,
                        command.actorUserId,
                        locale,
                        clock.instant(),
                    )
                }
                val persisted =
                    findByCreateRequest(command.workspaceId, command.actorUserId, command.requestId)
                        ?: error("Project create request did not resolve to a durable project")
                if (persisted.fingerprint != fingerprint) throw ProjectIdempotencyConflict()
                persisted.view
            },
        )
    }

    override fun edit(command: EditProjectCommand): ProjectView {
        requireWorkspaceOwner(command.actorUserId, command.workspaceId)
        if (command.expectedVersion < 0) throw ProjectValidationFailed("expectedVersion")
        val input = normalizedInput(command.name, command.description)
        return requireNotNull(
            transactions.execute {
                findAuthorizedProject(command.actorUserId, command.workspaceId, command.projectId)
                    ?: throw ProjectNotFound()
                val updated =
                    jdbc.update(
                        """
                        UPDATE project.projects p
                        SET name = ?, description = ?, version = version + 1, updated_at = ?
                        WHERE p.id = ? AND p.workspace_id = ? AND p.version = ?
                          AND EXISTS (
                              SELECT 1 FROM project.project_memberships m
                              WHERE m.project_id = p.id AND m.user_id = ? AND m.role = 'OWNER'
                          )
                        """.trimIndent(),
                        input.name,
                        input.description,
                        clock.instant().atOffset(ZoneOffset.UTC),
                        command.projectId,
                        command.workspaceId,
                        command.expectedVersion,
                        command.actorUserId,
                    )
                if (updated != 1) throw ProjectVersionConflict()
                findAuthorizedProject(command.actorUserId, command.workspaceId, command.projectId)
                    ?: error("Updated project is no longer readable")
            },
        )
    }

    override fun archive(command: ProjectStatusCommand): ProjectView = transition(command, ProjectStatus.ARCHIVED)

    override fun restore(command: ProjectStatusCommand): ProjectView = transition(command, ProjectStatus.ACTIVE)

    override fun permanentlyDelete(command: DeleteProjectCommand) {
        requireWorkspaceOwner(command.actorUserId, command.workspaceId)
        if (command.expectedVersion < 0) throw ProjectValidationFailed("expectedVersion")
        try {
            transactions.executeWithoutResult {
                val current =
                    findAuthorizedProjectForUpdate(command.actorUserId, command.workspaceId, command.projectId)
                        ?: throw ProjectNotFound()
                if (current.version != command.expectedVersion) throw ProjectVersionConflict()
                if (current.name != command.confirmationName) throw ProjectNameConfirmationMismatch()
                jdbc.update("DELETE FROM project.board_placements WHERE project_id = ?", command.projectId)
                jdbc.update("DELETE FROM project.board_columns WHERE project_id = ?", command.projectId)
                jdbc.update("DELETE FROM project.boards WHERE project_id = ?", command.projectId)
                jdbc.update("DELETE FROM project.work_items WHERE project_id = ?", command.projectId)
                jdbc.update("DELETE FROM project.project_memberships WHERE project_id = ?", command.projectId)
                if (
                    jdbc.update(
                        "DELETE FROM project.projects WHERE id = ? AND workspace_id = ? AND version = ?",
                        command.projectId,
                        command.workspaceId,
                        command.expectedVersion,
                    ) != 1
                ) {
                    throw ProjectVersionConflict()
                }
            }
        } catch (_: DataIntegrityViolationException) {
            throw ProjectDeleteRestricted()
        }
    }

    private fun transition(
        command: ProjectStatusCommand,
        target: ProjectStatus,
    ): ProjectView {
        requireWorkspaceOwner(command.actorUserId, command.workspaceId)
        if (command.expectedVersion < 0) throw ProjectValidationFailed("expectedVersion")
        return requireNotNull(
            transactions.execute {
                val current =
                    requireAuthorizedProject(command.actorUserId, command.workspaceId, command.projectId)
                if (current.status == target) return@execute current
                val timestamp = clock.instant().atOffset(ZoneOffset.UTC)
                val updated =
                    jdbc.update(
                        """
                        UPDATE project.projects p
                        SET status = ?, version = version + 1, updated_at = ?, archived_at = ?
                        WHERE p.id = ? AND p.workspace_id = ? AND p.status = ? AND p.version = ?
                          AND EXISTS (
                              SELECT 1 FROM project.project_memberships m
                              WHERE m.project_id = p.id AND m.user_id = ? AND m.role = 'OWNER'
                          )
                        """.trimIndent(),
                        target.name,
                        timestamp,
                        if (target == ProjectStatus.ARCHIVED) timestamp else null,
                        command.projectId,
                        command.workspaceId,
                        if (target == ProjectStatus.ARCHIVED) ProjectStatus.ACTIVE.name else ProjectStatus.ARCHIVED.name,
                        command.expectedVersion,
                        command.actorUserId,
                    )
                if (updated == 1) {
                    return@execute findAuthorizedProject(command.actorUserId, command.workspaceId, command.projectId)
                        ?: error("Transitioned project is no longer readable")
                }
                val concurrent =
                    requireAuthorizedProject(command.actorUserId, command.workspaceId, command.projectId)
                if (concurrent.status == target) concurrent else throw ProjectVersionConflict()
            },
        )
    }

    private fun requireWorkspaceOwner(
        userId: UUID,
        workspaceId: UUID,
    ) {
        if (workspaceAccess.roleFor(userId, workspaceId) != WorkspaceRole.OWNER) throw WorkspaceNotFound()
    }

    private fun requireAuthorizedProject(
        userId: UUID,
        workspaceId: UUID,
        projectId: UUID,
    ): ProjectView = findAuthorizedProject(userId, workspaceId, projectId) ?: throw ProjectNotFound()

    private fun findAuthorizedProject(
        userId: UUID,
        workspaceId: UUID,
        projectId: UUID,
    ): ProjectView? =
        jdbc
            .query(
                """
                SELECT p.id, p.workspace_id, p.name, p.description, p.status, p.version,
                       p.created_at, p.updated_at, p.archived_at
                FROM project.projects p
                JOIN project.project_memberships m
                  ON m.project_id = p.id AND m.user_id = ? AND m.role = 'OWNER'
                WHERE p.id = ? AND p.workspace_id = ?
                """.trimIndent(),
                PROJECT_ROW_MAPPER,
                userId,
                projectId,
                workspaceId,
            ).singleOrNull()

    private fun findAuthorizedProjectForUpdate(
        userId: UUID,
        workspaceId: UUID,
        projectId: UUID,
    ): ProjectView? =
        jdbc
            .query(
                """
                SELECT p.id, p.workspace_id, p.name, p.description, p.status, p.version,
                       p.created_at, p.updated_at, p.archived_at
                FROM project.projects p
                JOIN project.project_memberships m
                  ON m.project_id = p.id AND m.user_id = ? AND m.role = 'OWNER'
                WHERE p.id = ? AND p.workspace_id = ?
                FOR UPDATE OF p
                """.trimIndent(),
                PROJECT_ROW_MAPPER,
                userId,
                projectId,
                workspaceId,
            ).singleOrNull()

    private fun findByCreateRequest(
        workspaceId: UUID,
        userId: UUID,
        requestId: UUID,
    ): PersistedCreate? =
        jdbc
            .query(
                """
                SELECT p.id, p.workspace_id, p.name, p.description, p.status, p.version,
                       p.created_at, p.updated_at, p.archived_at, p.create_request_fingerprint
                FROM project.projects p
                WHERE p.workspace_id = ? AND p.created_by_user_id = ? AND p.create_request_id = ?
                """.trimIndent(),
                { rows, _ -> PersistedCreate(PROJECT_ROW_MAPPER.mapRow(rows, 0), rows.getString("create_request_fingerprint")) },
                workspaceId,
                userId,
                requestId,
            ).singleOrNull()

    private fun normalizedInput(
        name: String,
        description: String?,
    ): NormalizedProjectInput {
        val normalizedName = name.trim()
        val normalizedDescription = description?.trim().orEmpty()
        if (normalizedName.codePointCount() !in 1..MAXIMUM_NAME_CODE_POINTS) {
            throw ProjectValidationFailed("name")
        }
        if (normalizedDescription.codePointCount() > MAXIMUM_DESCRIPTION_CODE_POINTS) {
            throw ProjectValidationFailed("description")
        }
        return NormalizedProjectInput(normalizedName, normalizedDescription)
    }

    private fun fingerprint(
        input: NormalizedProjectInput,
        locale: String,
    ): String {
        val canonical =
            "${input.name.length}:${input.name}${input.description.length}:${input.description}${locale.length}:$locale"
        return MessageDigest
            .getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun normalizedLocale(locale: String): String {
        if (locale !in SUPPORTED_LOCALES) throw ProjectValidationFailed("locale")
        return locale
    }

    private fun String.codePointCount() = codePointCount(0, length)

    private data class NormalizedProjectInput(
        val name: String,
        val description: String,
    )

    private data class PersistedCreate(
        val view: ProjectView,
        val fingerprint: String,
    )

    private data class CursorPosition(
        val createdAt: Instant,
        val projectId: UUID,
    )

    private object ProjectCursor {
        fun encode(
            workspaceId: UUID,
            status: ProjectStatus,
            createdAt: Instant,
            projectId: UUID,
        ): String {
            val value = "v1|$workspaceId|${status.name}|${createdAt.epochSecond}|${createdAt.nano}|$projectId"
            return Base64.getUrlEncoder().withoutPadding().encodeToString(value.toByteArray(StandardCharsets.UTF_8))
        }

        fun decode(
            cursor: String,
            workspaceId: UUID,
            status: ProjectStatus,
        ): CursorPosition =
            try {
                val value = String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split('|')
                if (value.size != CURSOR_PARTS) throw ProjectValidationFailed("cursor")
                if (value[CURSOR_VERSION_INDEX] != CURSOR_VERSION) throw ProjectValidationFailed("cursor")
                if (UUID.fromString(value[CURSOR_WORKSPACE_INDEX]) != workspaceId) throw ProjectValidationFailed("cursor")
                if (ProjectStatus.valueOf(value[CURSOR_STATUS_INDEX]) != status) throw ProjectValidationFailed("cursor")
                CursorPosition(
                    Instant.ofEpochSecond(
                        value[CURSOR_EPOCH_SECOND_INDEX].toLong(),
                        value[CURSOR_NANO_INDEX].toLong(),
                    ),
                    UUID.fromString(value[CURSOR_PROJECT_INDEX]),
                )
            } catch (failure: ProjectValidationFailed) {
                throw failure
            } catch (_: RuntimeException) {
                throw ProjectValidationFailed("cursor")
            }
    }

    private companion object {
        const val MINIMUM_LIMIT = 1
        const val MAXIMUM_LIMIT = 100
        const val MAXIMUM_NAME_CODE_POINTS = 200
        const val MAXIMUM_DESCRIPTION_CODE_POINTS = 2000
        val SUPPORTED_LOCALES = setOf("zh-CN", "en")
        const val CURSOR_PARTS = 6
        const val CURSOR_VERSION = "v1"
        const val CURSOR_VERSION_INDEX = 0
        const val CURSOR_WORKSPACE_INDEX = 1
        const val CURSOR_STATUS_INDEX = 2
        const val CURSOR_EPOCH_SECOND_INDEX = 3
        const val CURSOR_NANO_INDEX = 4
        const val CURSOR_PROJECT_INDEX = 5

        val PROJECT_ROW_MAPPER =
            org.springframework.jdbc.core.RowMapper { rows, _ ->
                ProjectView(
                    rows.getObject("id", UUID::class.java),
                    rows.getObject("workspace_id", UUID::class.java),
                    rows.getString("name"),
                    rows.getString("description"),
                    ProjectStatus.valueOf(rows.getString("status")),
                    rows.getLong("version"),
                    rows.getObject("created_at", OffsetDateTime::class.java).toInstant(),
                    rows.getObject("updated_at", OffsetDateTime::class.java).toInstant(),
                    rows.getObject("archived_at", OffsetDateTime::class.java)?.toInstant(),
                )
            }
    }
}
