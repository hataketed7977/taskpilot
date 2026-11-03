package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.AuthenticatedActor

/** Trusted actor established by the Desktop access-bearer authentication filter. */
interface DesktopActor : AuthenticatedActor
