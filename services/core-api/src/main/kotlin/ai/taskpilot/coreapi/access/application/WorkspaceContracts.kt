package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.Workspace
import ai.taskpilot.coreapi.access.model.WorkspaceId
import ai.taskpilot.coreapi.access.model.WorkspaceType
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

class WorkspaceValidationException(
    val field: String,
    message: String,
) : IllegalArgumentException(message)

class WorkspaceStoreUnavailableException(
    cause: Throwable? = null,
) : RuntimeException("Workspace store unavailable", cause)

class WorkspaceTemporarilyUnavailableException(
    cause: Throwable? = null,
) : RuntimeException("Workspace temporarily unavailable", cause)

data class WorkspaceCreationDecision(
    val allowed: Boolean,
    val reasonCode: String? = null,
)

fun interface WorkspaceCreationPolicy {
    fun evaluate(actor: UserId): WorkspaceCreationDecision
}

class WorkspaceNamePolicy {
    fun normalize(raw: String): String {
        val normalized = raw.trim()
        val error =
            when {
                normalized.isEmpty() -> "Workspace name is required"
                normalized.codePointCount(0, normalized.length) > MAX_CODE_POINTS -> "Workspace name is too long"
                normalized.any(Char::isISOControl) -> "Workspace name contains a control character"
                else -> null
            }
        if (error != null) throw WorkspaceValidationException("name", error)
        return normalized
    }

    private companion object {
        const val MAX_CODE_POINTS = 80
    }
}

data class CreateWorkspaceCommand(
    val actor: UserId,
    val name: String,
    val idempotencyKey: String,
)

sealed interface CreateWorkspaceResult {
    data class Created(
        val workspace: Workspace,
    ) : CreateWorkspaceResult

    data class Replayed(
        val workspace: Workspace,
    ) : CreateWorkspaceResult

    data object IdempotencyConflict : CreateWorkspaceResult

    data object CreationNotAllowed : CreateWorkspaceResult

    data object TemporarilyUnavailable : CreateWorkspaceResult
}

data class WorkspaceListResult(
    val items: List<Workspace>,
    val canCreateWorkspace: Boolean,
    val createWorkspaceReasonCode: String? = null,
)

interface WorkspaceStore {
    fun create(
        actor: UserId,
        idempotencyKey: String,
        workspace: Workspace,
    ): CreateWorkspaceResult

    fun listAccessible(actor: UserId): List<Workspace>
}

class CreateOrganizationWorkspace(
    private val store: WorkspaceStore,
    private val creationPolicy: WorkspaceCreationPolicy = WorkspaceCreationPolicy { WorkspaceCreationDecision(true) },
    private val newWorkspaceId: () -> WorkspaceId = { WorkspaceId(UUID.randomUUID()) },
    private val namePolicy: WorkspaceNamePolicy = WorkspaceNamePolicy(),
) {
    fun execute(command: CreateWorkspaceCommand): CreateWorkspaceResult {
        if (!creationPolicy.evaluate(command.actor).allowed) return CreateWorkspaceResult.CreationNotAllowed
        if (command.idempotencyKey.isBlank() || command.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
            throw WorkspaceValidationException("idempotencyKey", "Invalid idempotency key")
        }
        val workspace =
            Workspace(
                newWorkspaceId(),
                namePolicy.normalize(command.name),
                WorkspaceType.ORGANIZATION,
            )
        return try {
            store.create(command.actor, command.idempotencyKey, workspace)
        } catch (_: WorkspaceStoreUnavailableException) {
            CreateWorkspaceResult.TemporarilyUnavailable
        }
    }

    private companion object {
        const val MAX_IDEMPOTENCY_KEY_LENGTH = 128
    }
}

class ListAccessibleWorkspaces(
    private val store: WorkspaceStore,
    private val creationPolicy: WorkspaceCreationPolicy = WorkspaceCreationPolicy { WorkspaceCreationDecision(true) },
) {
    fun execute(actor: UserId): WorkspaceListResult {
        val decision = creationPolicy.evaluate(actor)
        return try {
            WorkspaceListResult(
                items = store.listAccessible(actor),
                canCreateWorkspace = decision.allowed,
                createWorkspaceReasonCode = decision.reasonCode,
            )
        } catch (failure: WorkspaceStoreUnavailableException) {
            throw WorkspaceTemporarilyUnavailableException(failure)
        }
    }
}

internal fun workspacePayloadHash(workspace: Workspace): String =
    MessageDigest
        .getInstance("SHA-256")
        .digest("${workspace.type.name}\u0000${workspace.name}".toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
