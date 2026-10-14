package ai.taskpilot.coreapi.access

import java.util.UUID

/** Trusted actor established by the Desktop access-bearer authentication filter. */
interface DesktopActor {
    val userId: UUID
}
