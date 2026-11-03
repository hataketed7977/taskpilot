package ai.taskpilot.coreapi

import java.util.UUID

/** Client-neutral authenticated actor exposed by the HTTP security adapter. */
interface AuthenticatedActor {
    val userId: UUID
}
