package ai.taskpilot.coreapi.project.model

import java.util.UUID

@JvmInline
value class ProjectId(
    val value: UUID,
)

data class ProjectSummary(
    val projectId: ProjectId,
    val workspaceId: UUID,
    val name: String,
)
