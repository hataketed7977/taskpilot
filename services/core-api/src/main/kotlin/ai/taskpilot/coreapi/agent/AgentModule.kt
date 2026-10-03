package ai.taskpilot.coreapi.agent

import org.springframework.modulith.ApplicationModule
import org.springframework.modulith.PackageInfo

/** Public marker for the agent capability boundary. */
@PackageInfo
@ApplicationModule(displayName = "Agent", allowedDependencies = [])
class AgentModule
