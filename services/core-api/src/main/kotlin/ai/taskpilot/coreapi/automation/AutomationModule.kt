package ai.taskpilot.coreapi.automation

import org.springframework.modulith.ApplicationModule
import org.springframework.modulith.PackageInfo

/** Public marker for the automation capability boundary. */
@PackageInfo
@ApplicationModule(displayName = "Automation", allowedDependencies = [])
class AutomationModule
