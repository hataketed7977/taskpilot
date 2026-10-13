package ai.taskpilot.coreapi.project

import org.springframework.modulith.ApplicationModule
import org.springframework.modulith.PackageInfo

/** Public marker for the project capability boundary. */
@PackageInfo
@ApplicationModule(displayName = "Project", allowedDependencies = [])
class ProjectModule
