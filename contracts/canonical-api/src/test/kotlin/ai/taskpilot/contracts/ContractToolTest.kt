package ai.taskpilot.contracts

import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.Operation
import io.swagger.v3.oas.models.PathItem
import io.swagger.v3.oas.models.Paths
import io.swagger.v3.oas.models.parameters.QueryParameter
import io.swagger.v3.oas.models.Components
import io.swagger.v3.oas.models.media.ObjectSchema
import io.swagger.v3.oas.models.media.StringSchema
import io.swagger.v3.oas.models.responses.ApiResponse
import io.swagger.v3.oas.models.responses.ApiResponses
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class ContractToolTest {
    @Test
    fun `checked-in contract validates and projects all ingress operations`() {
        val api = parse(java.nio.file.Path.of("openapi.yaml"))
        validate(api)
        val manifest = projectManifest(api)
        val approvedOperations =
            api.paths.flatMap { (path, item) ->
                item.readOperationsMap().mapNotNull { (method, operation) ->
                    val ingress = operation.extensions["x-taskpilot-ingress"] as String
                    if (ingress == "none") {
                        null
                    } else {
                        RouteManifestEntry(method.name, path, operation.operationId, ingress)
                    }
                }
            }.toSet()

        assertEquals(approvedOperations, manifest.toSet())
        assertEquals(approvedOperations.size, manifest.size)
        assertEquals(1, manifest.count { it.ingress == "provider-callback" })
        assertTrue(manifest.none { it.path.startsWith("/desktop/") })
    }

    @Test
    fun `checked-in contract exposes work item creator assignee and project member candidates only`() {
        val api = parse(java.nio.file.Path.of("openapi.yaml"))
        val schemas = api.components.schemas

        val membersOperation = api.paths["/v1/projects/{projectId}/members"]?.get
            ?: error("Project Member list endpoint is missing")
        assertEquals("listProjectMembers", membersOperation.operationId)
        assertEquals("canonical", membersOperation.extensions["x-taskpilot-ingress"])
        assertEquals(listOf("accessBearer"), membersOperation.security.single().keys.toList())

        val workItem = schemas["WorkItemView"] ?: error("WorkItemView schema is missing")
        val card = schemas["CardView"] ?: error("CardView schema is missing")
        assertTrue(workItem.properties.containsKey("createdBy"))
        assertTrue(workItem.properties.containsKey("assignee"))
        assertTrue(card.properties.containsKey("assignee"))

        assertTrue(schemas.containsKey("PersonSummary"))
        assertTrue(schemas.containsKey("AssigneeTarget"))
        assertTrue(schemas.containsKey("ProjectMemberAssignee"))
        assertTrue(schemas.containsKey("ProjectMemberSummary"))
        assertTrue(schemas.containsKey("ProjectMemberList"))
        assertTrue(schemas.containsKey("AssigneePatch"))

        val projectMemberAssignee = schemas.getValue("ProjectMemberAssignee")
        val targetType = projectMemberAssignee.properties.getValue("targetType")
        assertEquals(listOf("PROJECT_MEMBER"), targetType.enum)

        assertTrue(api.paths.keys.none { it.contains("history", ignoreCase = true) })
        assertTrue(api.paths.keys.none { it.contains("versions", ignoreCase = true) })
        assertTrue(api.paths.keys.none { it.contains("activity", ignoreCase = true) })
        assertTrue(api.paths.keys.none { it.contains("agent", ignoreCase = true) })
        assertTrue(api.paths.keys.none { it.contains("project-memberships", ignoreCase = true) })
    }

    @Test
    fun `approved secret field is valid without example or default`() {
        validate(minimalApi(StringSchema()))
    }

    @Test
    fun `secret field example is rejected`() {
        assertFailsWith<IllegalArgumentException> {
            validate(minimalApi(StringSchema().also { it.example = "taskpilot-secret-sentinel" }))
        }
    }

    @Test
    fun `unknown ingress is rejected`() {
        val api = minimalApi(StringSchema())
        api.paths["/v1/example"]!!.post.extensions["x-taskpilot-ingress"] = "public-by-default"
        assertFailsWith<IllegalArgumentException> { validate(api) }
    }

    @Test
    fun `github callback permits only its protocol code and state query parameters`() {
        val operation = Operation()
            .operationId("githubCallback")
            .addParametersItem(QueryParameter().name("code").required(false).schema(StringSchema()))
            .addParametersItem(QueryParameter().name("state").required(true).schema(StringSchema()))
            .responses(ApiResponses().addApiResponse("200", ApiResponse().description("ok")))
            .apply { addExtension("x-taskpilot-ingress", "provider-callback") }
        val api = minimalApi(StringSchema()).paths(
            Paths().addPathItem("/v1/provider-callbacks/github/oauth", PathItem().get(operation)),
        )

        validate(api)
    }

    @Test
    fun `secret-like query parameter outside the fixed provider callback is rejected`() {
        val api = minimalApi(StringSchema())
        api.paths["/v1/example"]!!.post.addParametersItem(
            QueryParameter().name("accessToken").schema(StringSchema()),
        )

        assertFailsWith<IllegalStateException> { validate(api) }
    }

    @Test
    fun `provider callback classification does not permit other secret query parameters`() {
        val operation = Operation()
            .operationId("githubCallback")
            .addParametersItem(QueryParameter().name("clientSecret").schema(StringSchema()))
            .responses(ApiResponses().addApiResponse("200", ApiResponse().description("ok")))
            .apply { addExtension("x-taskpilot-ingress", "provider-callback") }
        val api = minimalApi(StringSchema()).paths(
            Paths().addPathItem("/v1/provider-callbacks/github/oauth", PathItem().get(operation)),
        )

        assertFailsWith<IllegalStateException> { validate(api) }
    }

    @Test
    fun `none ingress is excluded from manifest`() {
        val api = minimalApi(StringSchema())
        api.paths["/v1/example"]!!.post.extensions["x-taskpilot-ingress"] = "none"
        validate(api)
        assertTrue(projectManifest(api).isEmpty())
    }

    private fun minimalApi(secretSchema: StringSchema): OpenAPI {
        val response = ApiResponse().description("ok")
        val operation = Operation()
            .operationId("example")
            .responses(ApiResponses().addApiResponse("204", response))
            .apply { addExtension("x-taskpilot-ingress", "canonical") }
        val paths = Paths().addPathItem("/v1/example", PathItem().post(operation))
        val problem = ObjectSchema().addProperty("code", StringSchema())
        val request = ObjectSchema().addProperty("pollSecret", secretSchema)
        return OpenAPI()
            .paths(paths)
            .components(Components().addSchemas("TaskPilotProblemDetails", problem).addSchemas("Request", request))
    }
}
