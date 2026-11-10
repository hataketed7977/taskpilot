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
    fun `logout supports exclusive bearer or bounded refresh body without anonymous revocation`() {
        val api = parse(java.nio.file.Path.of("openapi.yaml"))
        val operation = api.paths.getValue("/v1/session:logout").post
        assertEquals("logout", operation.operationId)
        assertEquals("access-bearer-or-refresh-credential-body", operation.extensions["x-taskpilot-authentication"])
        assertEquals(listOf(setOf("accessBearer"), emptySet()), operation.security.map { it.keys.toSet() })
        assertEquals(false, operation.requestBody.required)
        assertTrue(operation.description.contains("not anonymous"))
        assertEquals(setOf("204", "400", "401", "503"), operation.responses.keys)
        val schema = api.components.schemas.getValue("LogoutRequest")
        assertEquals(false, schema.additionalProperties)
        assertEquals(setOf("refreshToken"), schema.properties.keys)
        val token = schema.properties.getValue("refreshToken")
        assertEquals(1, token.minLength)
        assertEquals(512, token.maxLength)
        assertEquals(null, token.example)
        assertEquals(null, token.default)
        assertEquals("refresh-credential-body", api.paths.getValue("/v1/session:refresh").post.extensions["x-taskpilot-authentication"])
        assertEquals("access-bearer", api.paths.getValue("/v1/me").get.extensions["x-taskpilot-authentication"])
    }

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

    @Test
    fun `write schemas declare product text limits sparse mutations and readable legacy responses`() {
        val api = parse(java.nio.file.Path.of("openapi.yaml"))
        val schemas = api.components.schemas

        assertText(schemas, "FederatedRegistrationRequest", "displayName", 1, 80)
        assertText(schemas, "CreateProjectRequest", "name", 1, 100)
        assertText(schemas, "CreateProjectRequest", "description", null, 1000)
        assertText(schemas, "CreateBoardRequest", "name", 1, 80)
        assertText(schemas, "CreateBoardRequest", "description", null, 1000)
        assertText(schemas, "CreateColumnRequest", "name", 1, 50)
        assertText(schemas, "EditColumnRequest", "name", 1, 50)
        assertText(schemas, "CreateWorkItemRequest", "title", 1, 160)
        assertText(schemas, "CreateWorkItemRequest", "description", null, 5000)

        assertSparseEdit(schemas, "EditProjectRequest", "name", "DescriptionPatch1000", 1, 100)
        assertSparseEdit(schemas, "EditBoardRequest", "name", "DescriptionPatch1000", 1, 80)
        assertSparseEdit(schemas, "EditWorkItemRequest", "title", "DescriptionPatch5000", 1, 160)
        assertNullFail(schemas, "EditWorkItemRequest", "assigneePatch")
        assertNullFail(schemas, "AssigneePatch", "target")

        assertDescriptionPatch(schemas, "DescriptionPatch1000", 1000)
        assertDescriptionPatch(schemas, "DescriptionPatch5000", 5000)

        val createWorkItem = schemas.getValue("CreateWorkItemRequest")
        assertTrue("assignee" !in createWorkItem.required.orEmpty())
        val createAssignee = createWorkItem.properties.getValue("assignee")
        assertEquals(2, createAssignee.oneOf.size)
        val nullAssignee = createAssignee.oneOf.single {
            it.type == "null" || "null" in it.types.orEmpty()
        }
        assertTrue(
            nullAssignee.type == "null" || "null" in nullAssignee.types.orEmpty(),
            "CreateWorkItemRequest.assignee must accept explicit JSON null",
        )
        val selection = createAssignee.oneOf.single { it !== nullAssignee }
        assertEquals(schemas.getValue("AssigneeSelection").properties.keys, selection.properties.keys)
        assertTrue(schemas.getValue("TaskPilotProblemDetails").properties.containsKey("path"))

        listOf("ProjectView" to "name", "ProjectView" to "description", "BoardView" to "name",
            "BoardView" to "description", "BoardColumnView" to "name", "WorkItemView" to "title",
            "WorkItemView" to "description", "CardView" to "title", "CardView" to "description",
        ).forEach { (schemaName, propertyName) ->
            val property = schemas.getValue(schemaName).properties.getValue(propertyName)
            assertEquals(null, property.maxLength, "$schemaName.$propertyName must keep historical values readable")
        }
    }

    @Test
    fun `generated projection uses Jackson null fail without Jakarta Bean Validation`() {
        val generatedRoot = java.nio.file.Path.of("build/generated/openapi/src/main/kotlin")
        val kotlinFiles = java.nio.file.Files.walk(generatedRoot).use { files ->
            files.filter { java.nio.file.Files.isRegularFile(it) && it.toString().endsWith(".kt") }
                .map(java.nio.file.Files::readString)
                .toList()
        }
        assertTrue(kotlinFiles.isNotEmpty())
        assertTrue(kotlinFiles.none { "jakarta.validation" in it })
        assertTrue(kotlinFiles.none { Regex("@(Valid|Validated|NotNull|Size|Pattern|Min|Max)\\b").containsMatchIn(it) })

        val generatedModels = generatedRoot.resolve("ai/taskpilot/contract/generated/model")
        mapOf(
            "EditProjectRequest.kt" to listOf("name", "descriptionPatch"),
            "EditBoardRequest.kt" to listOf("name", "descriptionPatch"),
            "EditWorkItemRequest.kt" to listOf("title", "descriptionPatch", "assigneePatch"),
            "DescriptionPatch1000.kt" to listOf("value"),
            "DescriptionPatch5000.kt" to listOf("value"),
            "AssigneePatch.kt" to listOf("target"),
        ).forEach { (fileName, properties) ->
            val source = java.nio.file.Files.readString(generatedModels.resolve(fileName))
            properties.forEach { property ->
                val declaration = Regex(
                    "@param:com\\.fasterxml\\.jackson\\.annotation\\.JsonSetter\\(nulls = com\\.fasterxml\\.jackson\\.annotation\\.Nulls\\.FAIL\\)" +
                        "[\\s\\S]{0,240}val $property:",
                )
                assertTrue(declaration.containsMatchIn(source), "$fileName.$property must reject explicit JSON null")
            }
        }
    }

    private fun assertText(
        schemas: Map<String, io.swagger.v3.oas.models.media.Schema<*>>,
        schemaName: String,
        propertyName: String,
        min: Int?,
        max: Int,
    ) {
        val property = schemas.getValue(schemaName).properties.getValue(propertyName)
        assertEquals(min, property.minLength, "$schemaName.$propertyName minLength")
        assertEquals(max, property.maxLength, "$schemaName.$propertyName maxLength")
    }

    private fun assertSparseEdit(
        schemas: Map<String, io.swagger.v3.oas.models.media.Schema<*>>,
        schemaName: String,
        scalarName: String,
        patchName: String,
        min: Int,
        max: Int,
    ) {
        val schema = schemas.getValue(schemaName)
        assertTrue(scalarName !in schema.required.orEmpty(), "$schemaName.$scalarName must be optional")
        assertText(schemas, schemaName, scalarName, min, max)
        assertNullFail(schemas, schemaName, scalarName)
        assertTrue("descriptionPatch" !in schema.required.orEmpty())
        val descriptionPatch = schema.properties.getValue("descriptionPatch")
        assertEquals(schemas.getValue(patchName).properties.keys, descriptionPatch.properties.keys)
        assertEquals(
            schemas.getValue(patchName).properties.getValue("value").maxLength,
            descriptionPatch.properties.getValue("value").maxLength,
        )
        assertNullFail(schemas, schemaName, "descriptionPatch")
        assertTrue("description" !in schema.properties)
    }

    private fun assertDescriptionPatch(
        schemas: Map<String, io.swagger.v3.oas.models.media.Schema<*>>,
        schemaName: String,
        max: Int,
    ) {
        val schema = schemas.getValue(schemaName)
        assertEquals(listOf("SET", "CLEAR"), schema.properties.getValue("action").enum)
        assertEquals(listOf("action"), schema.required)
        assertText(schemas, schemaName, "value", 1, max)
        assertNullFail(schemas, schemaName, "value")
    }

    private fun assertNullFail(
        schemas: Map<String, io.swagger.v3.oas.models.media.Schema<*>>,
        schemaName: String,
        propertyName: String,
    ) {
        val extension = schemas.getValue(schemaName).properties.getValue(propertyName)
            .extensions?.get("x-field-extra-annotation")
        assertEquals(
            "@param:com.fasterxml.jackson.annotation.JsonSetter(nulls = com.fasterxml.jackson.annotation.Nulls.FAIL)",
            extension,
            "$schemaName.$propertyName null handling",
        )
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
