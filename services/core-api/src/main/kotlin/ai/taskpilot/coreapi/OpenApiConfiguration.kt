package ai.taskpilot.coreapi

import io.swagger.v3.oas.models.Components
import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.info.Info
import io.swagger.v3.oas.models.media.Content
import io.swagger.v3.oas.models.media.IntegerSchema
import io.swagger.v3.oas.models.media.MediaType
import io.swagger.v3.oas.models.media.Schema
import io.swagger.v3.oas.models.media.StringSchema
import io.swagger.v3.oas.models.responses.ApiResponse
import io.swagger.v3.oas.models.responses.ApiResponses
import io.swagger.v3.oas.models.security.SecurityRequirement
import io.swagger.v3.oas.models.security.SecurityScheme
import org.springdoc.core.customizers.OperationCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.method.HandlerMethod

@Configuration(proxyBeanMethods = false)
class OpenApiConfiguration {
    @Bean
    fun taskPilotOpenApi(): OpenAPI = DesktopOpenApiContracts.document()

    @Bean
    fun desktopAuthenticationDocumentation(): OperationCustomizer =
        OperationCustomizer { operation, handler ->
            val authentication = DesktopOpenApiContracts.authenticationKind(handler)
            operation.addExtension("x-taskpilot-authentication", authentication)
            operation.security = DesktopOpenApiContracts.security(authentication)
            operation.responses = DesktopOpenApiContracts.responses(handler)
            DesktopOpenApiContracts.description(handler)?.let { operation.description = it }
            operation
        }
}

private data class ResponseContract(
    val successStatus: String,
    val responseSchema: String?,
    val problemStatuses: List<String>,
)

private data class OperationKey(
    val controller: String,
    val path: String,
    val method: String,
)

private object DesktopOpenApiContracts {
    private const val ACCESS_BEARER = "accessBearer"
    private const val ACCESS_BEARER_KIND = "access-bearer"

    fun document(): OpenAPI =
        OpenAPI()
            .info(Info().title("TaskPilot Desktop API").version("runtime"))
            .components(
                Components()
                    .addSecuritySchemes(
                        ACCESS_BEARER,
                        SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("opaque"),
                    ).addSchemas("TaskPilotProblemDetails", DesktopOpenApiResponses.problemDetailsSchema()),
            )

    fun authenticationKind(handler: HandlerMethod): String {
        val path = handler.relativePath()
        return when (handler.beanType.simpleName) {
            "FederatedAuthenticationController" -> {
                "anonymous"
            }

            "AuthenticationController" -> {
                when (path) {
                    "/auth/session/refresh" -> "refresh-credential-body"
                    "/auth/session/logout", "/me" -> ACCESS_BEARER_KIND
                    else -> "anonymous"
                }
            }

            else -> {
                ACCESS_BEARER_KIND
            }
        }
    }

    fun security(authentication: String): List<SecurityRequirement> =
        if (authentication == ACCESS_BEARER_KIND) {
            listOf(SecurityRequirement().addList(ACCESS_BEARER))
        } else {
            emptyList()
        }

    fun responses(handler: HandlerMethod): ApiResponses =
        responseContracts[handler.operationKey()]?.let(DesktopOpenApiResponses::from) ?: ApiResponses()

    fun description(handler: HandlerMethod): String? =
        operationDescriptions[handler.operationKey()]
            ?: when (authenticationKind(handler)) {
                ACCESS_BEARER_KIND -> ACTIVE_ACCESS_DESCRIPTION
                "refresh-credential-body" -> ACTIVE_REFRESH_DESCRIPTION
                else -> null
            }

    private val responseContracts =
        mapOf(
            operation("FederatedAuthenticationController", "/capabilities", "GET") to
                responseContract("200", "AuthenticationCapabilitiesResponse"),
            operation("FederatedAuthenticationController", "/federated/attempts", "POST") to
                responseContract("201", "FederatedAttemptResponse", "400", "429", "503"),
            operation("FederatedAuthenticationController", "/federated/github/callback", "GET") to
                responseContract("200", null, "400", "409", "503"),
            operation("FederatedAuthenticationController", "/federated/attempts/{attemptId}/poll", "POST") to
                responseContract("200", "FederatedPollResponse", "400", "409", "410", "503"),
            operation("FederatedAuthenticationController", "/federated/attempts/{attemptId}/cancel", "POST") to
                responseContract("204", null, "400", "409", "503"),
            operation("FederatedAuthenticationController", "/federated/registrations", "POST") to
                responseContract("201", "FederatedPollResponse", "400", "409", "503"),
            operation("AuthenticationController", "/auth/session/refresh", "POST") to
                responseContract("200", "SessionResponse", "400", "401", "503"),
            operation("AuthenticationController", "/auth/session/logout", "POST") to
                responseContract("204", null, "401"),
            operation("AuthenticationController", "/me", "GET") to
                responseContract("200", "CurrentUserResponse", "401"),
            operation("WorkspaceController", "", "GET") to
                responseContract("200", "PersonalWorkspaceResponse[]", "401", "503"),
            operation("ProjectController", "", "GET") to
                responseContract("200", "ProjectPage", "400", "401", "404", "503"),
            operation("ProjectController", "", "POST") to
                responseContract("201", "ProjectView", "400", "401", "404", "409", "503"),
            operation("ProjectController", "/{projectId}", "GET") to
                responseContract("200", "ProjectView", "400", "401", "404", "503"),
            operation("ProjectController", "/{projectId}", "PATCH") to
                responseContract("200", "ProjectView", "400", "401", "404", "409", "503"),
            operation("ProjectController", "/{projectId}/archive", "POST") to
                responseContract("200", "ProjectView", "400", "401", "404", "409", "503"),
            operation("ProjectController", "/{projectId}/restore", "POST") to
                responseContract("200", "ProjectView", "400", "401", "404", "409", "503"),
            operation("ProjectController", "/{projectId}/permanent-deletion", "POST") to
                responseContract("204", null, "400", "401", "404", "409", "503"),
        )

    private val operationDescriptions =
        mapOf(
            operation("FederatedAuthenticationController", "/federated/attempts/{attemptId}/poll", "POST") to
                "Desktop Main supplies its poll secret in the body. The browser completion proof is optional " +
                "while reading a pending status and is required before identity resolution. A known External " +
                "Identity returns an active opaque session; a new identity returns a private registration continuation.",
            operation("FederatedAuthenticationController", "/federated/registrations", "POST") to
                "Desktop Main privately owns and submits the registration continuation; Renderer must not receive it. " +
                "Successful registration returns an immediately active opaque session.",
            operation("WorkspaceController", "", "GET") to
                "Lists the authenticated User's accessible Workspaces. The current implementation returns the single " +
                "PERSONAL Workspace and its OWNER role.",
            operation("ProjectController", "", "GET") to
                "Lists ACTIVE or ARCHIVED Projects in the path-scoped Workspace using deterministic ordering, a bounded " +
                "limit, and an opaque cursor. Requires Workspace OWNER access.",
            operation("ProjectController", "", "POST") to
                "Creates a Project in the path-scoped Workspace. Requires Workspace OWNER access. requestId is idempotent " +
                "for the authenticated User and Workspace; duplicate Project names are allowed.",
            operation("ProjectController", "/{projectId}", "GET") to
                "Reads a Project only within the path-scoped Workspace and requires Project OWNER access.",
            operation("ProjectController", "/{projectId}", "PATCH") to
                "Edits the path-scoped Project as its Project OWNER. expectedVersion provides optimistic concurrency control.",
            operation("ProjectController", "/{projectId}/archive", "POST") to
                "Archives the path-scoped Project as its Project OWNER using expectedVersion.",
            operation("ProjectController", "/{projectId}/restore", "POST") to
                "Restores the path-scoped Project as its Project OWNER using expectedVersion.",
            operation("ProjectController", "/{projectId}/permanent-deletion", "POST") to
                "Permanently and irreversibly deletes the path-scoped Project as its Project OWNER. confirmationName must " +
                "exactly match the current name, expectedVersion rejects concurrent changes, and protected dependencies " +
                "reject deletion.",
        )

    private fun responseContract(
        successStatus: String,
        responseSchema: String?,
        vararg problemStatuses: String,
    ): ResponseContract = ResponseContract(successStatus, responseSchema, problemStatuses.toList())

    private fun operation(
        controller: String,
        path: String,
        method: String,
    ): OperationKey = OperationKey(controller, path, method)

    private fun HandlerMethod.operationKey(): OperationKey {
        val (path, httpMethod) =
            method.getAnnotation(GetMapping::class.java)?.let { it.value.firstOrNull().orEmpty() to "GET" }
                ?: method.getAnnotation(PostMapping::class.java)?.let { it.value.firstOrNull().orEmpty() to "POST" }
                ?: method.getAnnotation(PatchMapping::class.java)?.let { it.value.firstOrNull().orEmpty() to "PATCH" }
                ?: ("" to "")
        return operation(beanType.simpleName, path, httpMethod)
    }

    private fun HandlerMethod.relativePath(): String = operationKey().path

    private const val ACTIVE_ACCESS_DESCRIPTION =
        "Requires an access bearer credential from an active opaque session."
    private const val ACTIVE_REFRESH_DESCRIPTION =
        "Requires a refresh credential from an active opaque session in the request body; successful refresh rotates both tokens."
}

private object DesktopOpenApiResponses {
    private const val PROBLEM_SCHEMA = "TaskPilotProblemDetails"

    fun from(contract: ResponseContract): ApiResponses {
        val result = ApiResponses()
        addResponses(result, success(contract.successStatus, contract.responseSchema))
        contract.problemStatuses.forEach { status ->
            result.addApiResponse(status, ApiResponse().description("Request failed").content(problemContent()))
        }
        return result
    }

    fun success(
        status: String,
        schema: String? = null,
    ): Pair<String, ApiResponse> {
        val response = ApiResponse().description("Success")
        schema?.let { response.content(jsonContent(it)) }
        return status to response
    }

    fun problems(vararg statuses: String): Array<Pair<String, ApiResponse>> =
        statuses
            .map { status ->
                status to ApiResponse().description("Request failed").content(problemContent())
            }.toTypedArray()

    fun responses(vararg groups: Any): ApiResponses {
        val result = ApiResponses()
        groups.forEach { group -> addResponses(result, group) }
        return result
    }

    private fun addResponses(
        target: ApiResponses,
        group: Any,
    ) {
        when (group) {
            is Pair<*, *> -> {
                target.addApiResponse(group.first as String, group.second as ApiResponse)
            }

            is Array<*> -> {
                group.filterIsInstance<Pair<String, ApiResponse>>().forEach {
                    target.addApiResponse(it.first, it.second)
                }
            }
        }
    }

    private fun jsonContent(schema: String): Content {
        val responseSchema =
            if (schema.endsWith("[]")) {
                io.swagger.v3.oas.models.media
                    .ArraySchema()
                    .items(Schema<Any>().`$ref`("#/components/schemas/${schema.removeSuffix("[]")}"))
            } else {
                Schema<Any>().`$ref`("#/components/schemas/$schema")
            }
        return Content().addMediaType("application/json", MediaType().schema(responseSchema))
    }

    private fun problemContent(): Content =
        Content().addMediaType(
            "application/problem+json",
            MediaType().schema(Schema<Any>().`$ref`("#/components/schemas/$PROBLEM_SCHEMA")),
        )

    fun problemDetailsSchema(): Schema<Any> =
        Schema<Any>()
            .type("object")
            .addProperty("type", StringSchema().format("uri"))
            .addProperty("title", StringSchema())
            .addProperty("status", IntegerSchema().format("int32"))
            .addProperty("detail", StringSchema())
            .addProperty("instance", StringSchema().format("uri"))
            .addProperty("code", StringSchema())
            .addProperty("correlationId", StringSchema())
            .addProperty("path", StringSchema())
            .addProperty("retryAfterSeconds", IntegerSchema().format("int64"))
}
