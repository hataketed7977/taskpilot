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
            operation
        }
}

private data class ResponseContract(
    val successStatus: String,
    val responseSchema: String?,
    val problemStatuses: List<String>,
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
        return when {
            handler.beanType.simpleName != "AuthenticationController" -> ACCESS_BEARER_KIND
            path == "/auth/session/refresh" -> "refresh-credential-body"
            path == "/auth/session/logout" || path == "/me" -> ACCESS_BEARER_KIND
            else -> "anonymous"
        }
    }

    fun security(authentication: String): List<SecurityRequirement> =
        if (authentication == ACCESS_BEARER_KIND) {
            listOf(SecurityRequirement().addList(ACCESS_BEARER))
        } else {
            emptyList()
        }

    fun responses(handler: HandlerMethod): ApiResponses {
        val key = handler.beanType.simpleName to handler.relativePath()
        return when {
            key.first == "WorkspaceController" -> workspaceResponses(handler.method.name)
            key.first == "ProjectController" -> DesktopOpenApiResponses.from(projectContract)
            else -> responseContracts[key]?.let(DesktopOpenApiResponses::from) ?: ApiResponses()
        }
    }

    private val projectContract =
        responseContract("200", "ProjectPageResponse", "400", "401", "404", "503")

    private val responseContracts =
        mapOf(
            ("AuthenticationController" to "/auth/registration/code") to
                responseContract("202", "CodeAcceptedResponse", "400", "429", "503"),
            ("AuthenticationController" to "/auth/login/code") to
                responseContract("202", "CodeAcceptedResponse", "400", "429", "503"),
            ("AuthenticationController" to "/auth/password-reset/code") to
                responseContract("202", "CodeAcceptedResponse", "400", "429", "503"),
            ("AuthenticationController" to "/auth/registration/code/verify") to
                responseContract("200", "ContinuationResponse", "400", "401", "429", "503"),
            ("AuthenticationController" to "/auth/password-reset/code/verify") to
                responseContract("200", "ContinuationResponse", "400", "401", "429", "503"),
            ("AuthenticationController" to "/auth/registration") to
                responseContract("201", "SessionResponse", "400", "409", "503"),
            ("AuthenticationController" to "/auth/login/password") to
                responseContract("200", "SessionResponse", "400", "401", "503"),
            ("AuthenticationController" to "/auth/login/code/verify") to
                responseContract("200", "SessionResponse", "400", "401", "429", "503"),
            ("AuthenticationController" to "/auth/password-reset") to
                responseContract("204", null, "400", "409", "503"),
            ("AuthenticationController" to "/auth/session/refresh") to
                responseContract("200", "SessionResponse", "400", "401", "503"),
            ("AuthenticationController" to "/auth/session/logout") to
                responseContract("204", null, "401"),
            ("AuthenticationController" to "/me") to
                responseContract("200", "CurrentUserResponse", "401"),
        )

    private fun responseContract(
        successStatus: String,
        responseSchema: String?,
        vararg problemStatuses: String,
    ): ResponseContract = ResponseContract(successStatus, responseSchema, problemStatuses.toList())

    private fun HandlerMethod.relativePath(): String =
        method.getAnnotation(PostMapping::class.java)?.value?.firstOrNull()
            ?: method.getAnnotation(GetMapping::class.java)?.value?.firstOrNull()
            ?: ""

    private fun workspaceResponses(methodName: String): ApiResponses =
        if (methodName == "list") {
            DesktopOpenApiResponses.responses(
                DesktopOpenApiResponses.success("200", "WorkspaceListResponse"),
                DesktopOpenApiResponses.problems("401", "503"),
            )
        } else {
            DesktopOpenApiResponses.responses(
                DesktopOpenApiResponses.success("200", "WorkspaceResponse"),
                DesktopOpenApiResponses.success("201", "WorkspaceResponse"),
                DesktopOpenApiResponses.problems("400", "401", "403", "409", "503"),
            )
        }
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

    private fun jsonContent(schema: String): Content =
        Content().addMediaType(
            "application/json",
            MediaType().schema(Schema<Any>().`$ref`("#/components/schemas/$schema")),
        )

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
