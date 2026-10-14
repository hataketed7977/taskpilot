package ai.taskpilot.coreapi.architecture

import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.isDirectory
import kotlin.test.Test
import kotlin.test.assertFalse

class CapabilitySqlOwnershipTest {
    @Test
    fun `Workspace persistence does not query Access private tables`() {
        val source = readCapabilitySources("workspace")

        listOf(
            "access.users",
            "access.external_identities",
            "access.terms_acceptances",
        ).forEach { privateTable ->
            assertFalse(
                source.contains(privateTable),
                "Workspace production source must not query the Access-owned table $privateTable",
            )
        }
    }

    @Test
    fun `Project does not query Workspace private tables`() {
        val source = readCapabilitySources("project")

        listOf(
            "workspace.workspaces",
            "workspace.workspace_memberships",
        ).forEach { privateTable ->
            assertFalse(
                source.contains(privateTable),
                "Project production source must use the public Workspace contract instead of querying $privateTable",
            )
        }
    }

    private fun readCapabilitySources(capability: String): String {
        val directory = findCoreApiSourceRoot().resolve(capability)
        Files.walk(directory).use { paths ->
            return paths
                .filter { path -> Files.isRegularFile(path) && path.fileName.toString().endsWith(".kt") }
                .sorted()
                .map(Files::readString)
                .toList()
                .joinToString("\n")
        }
    }

    private fun findCoreApiSourceRoot(): Path {
        var candidate = Path.of("").toAbsolutePath().normalize()
        while (true) {
            val repositoryRelative = candidate.resolve(CORE_API_SOURCE_ROOT)
            if (repositoryRelative.isDirectory()) {
                return repositoryRelative
            }
            val projectRelative = candidate.resolve(PROJECT_SOURCE_ROOT)
            if (projectRelative.isDirectory() && candidate.fileName?.toString() == "core-api") {
                return projectRelative
            }
            candidate = candidate.parent ?: error("Cannot locate the Core API production source root")
        }
    }

    private companion object {
        val CORE_API_SOURCE_ROOT: Path =
            Path.of("services", "core-api", "src", "main", "kotlin", "ai", "taskpilot", "coreapi")
        val PROJECT_SOURCE_ROOT: Path = Path.of("src", "main", "kotlin", "ai", "taskpilot", "coreapi")
    }
}
