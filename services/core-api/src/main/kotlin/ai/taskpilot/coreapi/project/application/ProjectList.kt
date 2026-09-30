package ai.taskpilot.coreapi.project.application

import ai.taskpilot.coreapi.access.WorkspaceAuthorizationUnavailableException
import ai.taskpilot.coreapi.access.WorkspaceMembershipAuthorizer
import ai.taskpilot.coreapi.project.model.ProjectSummary
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.UUID

data class ProjectPage(
    val items: List<ProjectSummary>,
    val nextCursor: String? = null,
)

sealed interface ListProjectsResult {
    data class Found(
        val page: ProjectPage,
    ) : ListProjectsResult

    data object WorkspaceNotFound : ListProjectsResult

    data object TemporarilyUnavailable : ListProjectsResult
}

class ProjectListStoreUnavailableException(
    cause: Throwable? = null,
) : RuntimeException("Project list store unavailable", cause)

interface ProjectListStore {
    fun list(
        actor: UUID,
        workspaceId: UUID,
        afterProjectId: UUID?,
        limit: Int,
    ): List<ProjectSummary>
}

class ProjectQueryValidationException(
    message: String,
) : IllegalArgumentException(message)

class ListProjects(
    private val authorizer: WorkspaceMembershipAuthorizer,
    private val store: ProjectListStore,
) {
    fun execute(
        actor: UUID,
        workspaceId: UUID,
        cursor: String?,
        limit: Int,
    ): ListProjectsResult {
        if (limit !in MINIMUM_LIMIT..MAXIMUM_LIMIT) {
            throw ProjectQueryValidationException("limit must be between 1 and 100")
        }
        val authorized = authorize(actor, workspaceId) ?: return ListProjectsResult.TemporarilyUnavailable
        return if (!authorized) {
            ListProjectsResult.WorkspaceNotFound
        } else {
            listAuthorized(actor, workspaceId, cursor, limit)
        }
    }

    private fun authorize(
        actor: UUID,
        workspaceId: UUID,
    ): Boolean? =
        try {
            authorizer.canAccess(actor, workspaceId)
        } catch (_: WorkspaceAuthorizationUnavailableException) {
            null
        }

    private fun listAuthorized(
        actor: UUID,
        workspaceId: UUID,
        cursor: String?,
        limit: Int,
    ): ListProjectsResult {
        val after = cursor?.let { ProjectCursor.decode(it, workspaceId) }
        val fetched =
            try {
                store.list(actor, workspaceId, after, limit + LOOKAHEAD)
            } catch (_: ProjectListStoreUnavailableException) {
                return ListProjectsResult.TemporarilyUnavailable
            }
        val items = fetched.take(limit)
        val next =
            if (fetched.size > limit) {
                ProjectCursor.encode(workspaceId, items.last().projectId.value)
            } else {
                null
            }
        return ListProjectsResult.Found(ProjectPage(items, next))
    }

    private companion object {
        const val MINIMUM_LIMIT = 1
        const val MAXIMUM_LIMIT = 100
        const val LOOKAHEAD = 1
    }
}

object ProjectCursor {
    private const val VERSION = "v1"
    private const val PART_COUNT = 3

    fun encode(
        workspaceId: UUID,
        projectId: UUID,
    ): String =
        Base64
            .getUrlEncoder()
            .withoutPadding()
            .encodeToString("$VERSION:$workspaceId:$projectId".toByteArray(StandardCharsets.UTF_8))

    fun decode(
        cursor: String,
        expectedWorkspaceId: UUID,
    ): UUID {
        val parts = decodeParts(cursor)
        val workspaceId = parseUuid(parts[1])
        if (workspaceId != expectedWorkspaceId) {
            throw ProjectQueryValidationException("Cursor belongs to another workspace")
        }
        return parseUuid(parts[2])
    }

    private fun decodeParts(cursor: String): List<String> {
        val decoded =
            runCatching {
                String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
            }.getOrElse { throw ProjectQueryValidationException("Invalid cursor") }
        val parts = decoded.split(':')
        if (parts.size != PART_COUNT || parts[0] != VERSION) {
            throw ProjectQueryValidationException("Invalid cursor")
        }
        return parts
    }

    private fun parseUuid(value: String): UUID =
        runCatching { UUID.fromString(value) }
            .getOrElse { throw ProjectQueryValidationException("Invalid cursor") }
}
