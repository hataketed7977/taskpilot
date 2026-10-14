package ai.taskpilot.coreapi

import org.springframework.modulith.test.ApplicationModuleTest
import org.springframework.modulith.test.ApplicationModuleTest.BootstrapMode.STANDALONE
import kotlin.test.Test

@ApplicationModuleTest(module = "access", mode = STANDALONE, verifyAutomatically = true)
class AccessModuleTest {
    @Test fun `access module starts standalone`() = Unit
}

@ApplicationModuleTest(module = "workspace", mode = STANDALONE, verifyAutomatically = true)
class WorkspaceModuleTest {
    @Test fun `workspace module starts with its declared dependencies`() = Unit
}

@ApplicationModuleTest(module = "project", mode = STANDALONE, verifyAutomatically = true)
class ProjectModuleTest {
    @Test fun `project module starts standalone`() = Unit
}

@ApplicationModuleTest(module = "onboarding", mode = STANDALONE, verifyAutomatically = true)
class OnboardingModuleTest {
    @Test fun `onboarding module starts with its declared dependencies`() = Unit
}

@ApplicationModuleTest(module = "automation", mode = STANDALONE, verifyAutomatically = true)
class AutomationModuleTest {
    @Test fun `automation module starts standalone`() = Unit
}

@ApplicationModuleTest(module = "agent", mode = STANDALONE, verifyAutomatically = true)
class AgentModuleTest {
    @Test fun `agent module starts standalone`() = Unit
}
