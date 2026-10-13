package ai.taskpilot.coreapi

import org.springframework.modulith.test.ApplicationModuleTest
import org.springframework.modulith.test.ApplicationModuleTest.BootstrapMode.STANDALONE
import kotlin.test.Test

@ApplicationModuleTest(module = "access", mode = STANDALONE, verifyAutomatically = true)
class AccessModuleTest {
    @Test fun `access module starts standalone`() = Unit
}

@ApplicationModuleTest(module = "project", mode = STANDALONE, verifyAutomatically = true)
class ProjectModuleTest {
    @Test fun `project module starts standalone`() = Unit
}

@ApplicationModuleTest(module = "automation", mode = STANDALONE, verifyAutomatically = true)
class AutomationModuleTest {
    @Test fun `automation module starts standalone`() = Unit
}

@ApplicationModuleTest(module = "agent", mode = STANDALONE, verifyAutomatically = true)
class AgentModuleTest {
    @Test fun `agent module starts standalone`() = Unit
}
