package ai.taskpilot.coreapi.workspace

import org.springframework.modulith.ApplicationModule
import org.springframework.modulith.PackageInfo

/** Owns Workspace identity, membership, provisioning, and authorization. */
@PackageInfo
@ApplicationModule(displayName = "Workspace", allowedDependencies = ["access"])
class WorkspaceModule
