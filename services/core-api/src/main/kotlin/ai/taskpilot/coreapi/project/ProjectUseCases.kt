package ai.taskpilot.coreapi.project

import java.time.Instant
import java.util.UUID

enum class ProjectStatus {
    ACTIVE,
    ARCHIVED,
}

data class ProjectView(
    val projectId: UUID,
    val workspaceId: UUID,
    val name: String,
    val description: String,
    val status: ProjectStatus,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant,
    val archivedAt: Instant?,
)

data class ProjectPage(
    val items: List<ProjectView>,
    val nextCursor: String?,
)

data class CreateProjectCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val requestId: UUID,
    val name: String,
    val description: String?,
)

data class EditProjectCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val expectedVersion: Long,
    val name: String,
    val description: String?,
)

data class ProjectStatusCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val expectedVersion: Long,
)

data class DeleteProjectCommand(
    val actorUserId: UUID,
    val workspaceId: UUID,
    val projectId: UUID,
    val expectedVersion: Long,
    val confirmationName: String,
)

interface ProjectUseCases {
    fun list(
        actorUserId: UUID,
        workspaceId: UUID,
        status: ProjectStatus,
        limit: Int,
        cursor: String?,
    ): ProjectPage

    fun detail(
        actorUserId: UUID,
        workspaceId: UUID,
        projectId: UUID,
    ): ProjectView

    fun create(command: CreateProjectCommand): ProjectView

    fun edit(command: EditProjectCommand): ProjectView

    fun archive(command: ProjectStatusCommand): ProjectView

    fun restore(command: ProjectStatusCommand): ProjectView

    fun permanentlyDelete(command: DeleteProjectCommand)
}

sealed class ProjectFailure(
    message: String,
) : RuntimeException(message)

class WorkspaceNotFound : ProjectFailure("WORKSPACE_NOT_FOUND")

class ProjectNotFound : ProjectFailure("PROJECT_NOT_FOUND")

class ProjectValidationFailed(
    val path: String,
) : ProjectFailure("VALIDATION_FAILED")

class ProjectIdempotencyConflict : ProjectFailure("IDEMPOTENCY_CONFLICT")

class ProjectVersionConflict : ProjectFailure("PROJECT_VERSION_CONFLICT")

class ProjectNameConfirmationMismatch : ProjectFailure("PROJECT_NAME_CONFIRMATION_MISMATCH")

class ProjectDeleteRestricted : ProjectFailure("PROJECT_DELETE_RESTRICTED")
