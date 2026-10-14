package ai.taskpilot.coreapi.onboarding

import org.springframework.modulith.ApplicationModule
import org.springframework.modulith.PackageInfo

/** Coordinates the one-time creation of a complete account across Access, Workspace, and Project. */
@PackageInfo
@ApplicationModule(displayName = "Onboarding", allowedDependencies = ["access", "workspace", "project"])
class OnboardingModule
