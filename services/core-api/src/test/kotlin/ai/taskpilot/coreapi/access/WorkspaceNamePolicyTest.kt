package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.WorkspaceNamePolicy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkspaceNamePolicyTest {
    private val policy = WorkspaceNamePolicy()

    @Test
    fun `trims a valid name and counts Unicode code points`() {
        assertEquals("研发 🚀", policy.normalize("  研发 🚀  "))
        assertEquals("😀".repeat(80), policy.normalize("😀".repeat(80)))
    }

    @Test
    fun `rejects empty overlong and control character names`() {
        listOf("   ", "😀".repeat(81), "bad\nname", "bad\u0000name").forEach { value ->
            assertFailsWith<IllegalArgumentException> { policy.normalize(value) }
        }
    }

    @Test
    fun `does not treat a display name as an identity`() {
        assertEquals("Same name", policy.normalize("Same name"))
        assertEquals("Same name", policy.normalize(" Same name "))
    }
}
