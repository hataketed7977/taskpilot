package ai.taskpilot.coreapi.project.api

import ai.taskpilot.coreapi.project.ProjectPage
import ai.taskpilot.coreapi.project.ProjectStatus
import ai.taskpilot.coreapi.project.ProjectView
import java.time.Instant
import java.time.ZoneOffset
import ai.taskpilot.contract.generated.model.ProjectPage as WireProjectPage
import ai.taskpilot.contract.generated.model.ProjectView as WireProjectView

internal fun ProjectPage.toWireResponse() = WireProjectPage(items.map { it.toWireResponse() }, nextCursor)

internal fun ProjectView.toWireResponse() =
    WireProjectView(
        projectId,
        workspaceId,
        name,
        description,
        status.toWireStatus(),
        version,
        createdAt.toWireTime(),
        updatedAt.toWireTime(),
        archivedAt?.toWireTime(),
    )

private fun ProjectStatus.toWireStatus() =
    when (this) {
        ProjectStatus.ACTIVE -> WireProjectView.Status.ACTIVE
        ProjectStatus.ARCHIVED -> WireProjectView.Status.ARCHIVED
    }

private fun Instant.toWireTime() = atOffset(ZoneOffset.UTC)
