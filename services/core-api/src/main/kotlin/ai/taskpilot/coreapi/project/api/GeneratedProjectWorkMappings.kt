package ai.taskpilot.coreapi.project.api

import ai.taskpilot.coreapi.project.BoardColumnView
import ai.taskpilot.coreapi.project.BoardSummary
import ai.taskpilot.coreapi.project.BoardView
import ai.taskpilot.coreapi.project.CardView
import ai.taskpilot.coreapi.project.CreateWorkItemResult
import ai.taskpilot.coreapi.project.EditWorkItemResult
import ai.taskpilot.coreapi.project.WorkItemView
import java.time.Instant
import java.time.ZoneOffset
import ai.taskpilot.contract.generated.model.BoardColumnView as WireBoardColumnView
import ai.taskpilot.contract.generated.model.BoardSummary as WireBoardSummary
import ai.taskpilot.contract.generated.model.BoardView as WireBoardView
import ai.taskpilot.contract.generated.model.CardView as WireCardView
import ai.taskpilot.contract.generated.model.CreateWorkItemResult as WireCreateWorkItemResult
import ai.taskpilot.contract.generated.model.EditWorkItemResult as WireEditWorkItemResult
import ai.taskpilot.contract.generated.model.WorkItemView as WireWorkItemView

internal fun BoardSummary.toWireResponse() =
    WireBoardSummary(boardId, projectId, name, description, version, createdAt.toWireTime(), updatedAt.toWireTime())

internal fun BoardView.toWireResponse() =
    WireBoardView(
        boardId,
        projectId,
        name,
        description,
        version,
        createdAt.toWireTime(),
        updatedAt.toWireTime(),
        columns.map { it.toWireResponse() },
    )

internal fun BoardColumnView.toWireResponse() =
    WireBoardColumnView(
        columnId,
        name,
        position,
        version,
        createdAt.toWireTime(),
        updatedAt.toWireTime(),
        cards.map { it.toWireResponse() },
    )

internal fun CardView.toWireResponse() = WireCardView(workItemId, title, description, workItemVersion, placementVersion, position)

internal fun WorkItemView.toWireResponse() =
    WireWorkItemView(workItemId, projectId, title, description, version, createdAt.toWireTime(), updatedAt.toWireTime())

internal fun CreateWorkItemResult.toWireResponse() = WireCreateWorkItemResult(workItem.toWireResponse(), board.toWireResponse())

internal fun EditWorkItemResult.toWireResponse() = WireEditWorkItemResult(workItem.toWireResponse(), board.toWireResponse())

private fun Instant.toWireTime() = atOffset(ZoneOffset.UTC)
