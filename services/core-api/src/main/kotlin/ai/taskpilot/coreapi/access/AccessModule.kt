package ai.taskpilot.coreapi.access

import org.springframework.modulith.ApplicationModule
import org.springframework.modulith.PackageInfo

/** Public marker for the access capability boundary. */
@PackageInfo
@ApplicationModule(displayName = "Access", allowedDependencies = [])
class AccessModule
