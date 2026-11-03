package ai.taskpilot.contracts

import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.Operation
import io.swagger.v3.oas.models.PathItem
import io.swagger.v3.oas.models.media.Schema
import io.swagger.v3.parser.OpenAPIV3Parser
import io.swagger.v3.parser.core.models.ParseOptions
import java.nio.file.Files
import java.nio.file.Path

private val supportedMethods =
    listOf(
        PathItem.HttpMethod.GET,
        PathItem.HttpMethod.POST,
        PathItem.HttpMethod.PUT,
        PathItem.HttpMethod.PATCH,
        PathItem.HttpMethod.DELETE,
    )
private val allowedIngress = setOf("canonical", "provider-callback", "none")
private val secretNames = setOf("secret", "token", "proof", "nonce", "continuation", "code", "state", "verifier")
private val forbiddenSecretValues = setOf("taskpilot-secret-sentinel", "real-secret", "github-client-secret")
private const val GITHUB_CALLBACK_PATH = "/v1/provider-callbacks/github/oauth"
private val githubCallbackQueryParameters = setOf("code", "state")

data class RouteManifestEntry(
    val method: String,
    val path: String,
    val operationId: String,
    val ingress: String,
)

fun main(args: Array<String>) {
    require(args.size >= 2) { "Usage: ContractTool <validate|manifest> <openapi> [manifest-output]" }
    val api = parse(Path.of(args[1]))
    validate(api)
    if (args[0] == "manifest") {
        require(args.size == 3) { "manifest mode requires an output path" }
        writeManifest(projectManifest(api), Path.of(args[2]))
    } else {
        require(args[0] == "validate") { "Unknown mode: ${args[0]}" }
    }
}

fun parse(path: Path): OpenAPI {
    val options = ParseOptions().apply {
        isResolve = true
        isResolveFully = false
    }
    val result = OpenAPIV3Parser().readLocation(path.toUri().toString(), null, options)
    require(result.messages.orEmpty().isEmpty()) { "OpenAPI parse errors: ${result.messages.joinToString()}" }
    return requireNotNull(result.openAPI) { "OpenAPI parser returned no document" }
}

fun validate(api: OpenAPI) {
    require(api.paths?.isNotEmpty() == true) { "Canonical OpenAPI must declare paths" }
    val ids = mutableSetOf<String>()
    operations(api).forEach { (path, method, operation) ->
        require(path.startsWith("/v1/")) { "Non-canonical path is forbidden: $path" }
        require(!path.startsWith("/desktop/")) { "Legacy Desktop path is forbidden: $path" }
        require(!path.contains("swagger", true) && !path.contains("api-docs", true) && !path.contains("actuator", true)) {
            "Documentation or management path is forbidden: $path"
        }
        val id = operation.operationId?.takeIf(String::isNotBlank)
            ?: error("Missing operationId for $method $path")
        require(ids.add(id)) { "Duplicate operationId: $id" }
        val ingress = operation.extensions?.get("x-taskpilot-ingress") as? String
            ?: error("Missing x-taskpilot-ingress for $method $path")
        require(ingress in allowedIngress) { "Unknown ingress '$ingress' for $method $path" }
        require(operation.responses?.isNotEmpty() == true) { "Missing responses for $method $path" }
        operation.responses.orEmpty()
            .filterKeys { !it.startsWith("2") }
            .forEach { (status, response) ->
                val ref = response.content?.get("application/problem+json")?.schema?.`$ref`
                require(ref == "#/components/schemas/TaskPilotProblemDetails") {
                    "$method $path $status must use TaskPilotProblemDetails"
                }
            }
        validateSecretParameters(path, method, operation)
    }
    require(api.components?.schemas?.containsKey("TaskPilotProblemDetails") == true) {
        "TaskPilotProblemDetails schema is required"
    }
    api.components.schemas.forEach { (name, schema) -> validateSecretSchema(name, schema, api.components.schemas) }
}

fun projectManifest(api: OpenAPI): List<RouteManifestEntry> =
    operations(api)
        .mapNotNull { (path, method, operation) ->
            val ingress = operation.extensions?.get("x-taskpilot-ingress") as String
            if (ingress == "none") null else RouteManifestEntry(method.name, path, operation.operationId, ingress)
        }
        .sortedWith(compareBy(RouteManifestEntry::path, RouteManifestEntry::method))
        .also { entries ->
            require(entries.map { it.method to it.path }.toSet().size == entries.size) { "Duplicate route in manifest" }
        }

fun writeManifest(entries: List<RouteManifestEntry>, output: Path) {
    Files.createDirectories(output.parent)
    val content = buildString {
        append("[\n")
        entries.forEachIndexed { index, entry ->
            append("  {\"method\":\"").append(entry.method)
                .append("\",\"path\":\"").append(json(entry.path))
                .append("\",\"operationId\":\"").append(json(entry.operationId))
                .append("\",\"ingress\":\"").append(entry.ingress).append("\"}")
            if (index != entries.lastIndex) append(',')
            append('\n')
        }
        append("]\n")
    }
    Files.writeString(output, content)
}

private fun operations(api: OpenAPI): List<Triple<String, PathItem.HttpMethod, Operation>> =
    api.paths.orEmpty().flatMap { (path, item) ->
        item.readOperationsMap().orEmpty()
            .filterKeys { it in supportedMethods }
            .map { (method, operation) -> Triple(path, method, operation) }
    }

private fun validateSecretParameters(path: String, method: PathItem.HttpMethod, operation: Operation) {
    operation.parameters.orEmpty().forEach { parameter ->
        val protocolCallbackParameter =
            path == GITHUB_CALLBACK_PATH &&
                method == PathItem.HttpMethod.GET &&
                operation.extensions?.get("x-taskpilot-ingress") == "provider-callback" &&
                parameter.`in` == "query" &&
                parameter.name in githubCallbackQueryParameters
        if (
            parameter.`in` in setOf("path", "query") &&
            secretNames.any { parameter.name.contains(it, true) } &&
            !protocolCallbackParameter
        ) {
            error("Secret-like parameter cannot be in URL: $method $path ${parameter.name}")
        }
        validateForbiddenValue("$method $path parameter ${parameter.name}", parameter.example)
        validateForbiddenValue("$method $path parameter ${parameter.name}", parameter.schema?.default)
    }
}

private fun validateSecretSchema(name: String, schema: Schema<*>, schemas: Map<String, Schema<*>>, visited: Set<String> = emptySet()) {
    if (name in visited) return
    schema.properties.orEmpty().forEach { (propertyName, property) ->
        if (secretNames.any { propertyName.contains(it, true) }) {
            require(property.example == null) { "Secret-bearing field has example: $name.$propertyName" }
            require(property.default == null) { "Secret-bearing field has default: $name.$propertyName" }
        }
        validateForbiddenValue("$name.$propertyName", property.example)
        validateForbiddenValue("$name.$propertyName", property.default)
        val ref = property.`$ref`?.substringAfterLast('/')
        if (ref != null && schemas.containsKey(ref)) validateSecretSchema(ref, schemas.getValue(ref), schemas, visited + name)
    }
}

private fun validateForbiddenValue(location: String, value: Any?) {
    val text = value?.toString()?.lowercase() ?: return
    require(forbiddenSecretValues.none(text::contains)) { "Forbidden secret value at $location" }
}

private fun json(value: String): String =
    value.replace("\\", "\\\\").replace("\"", "\\\"")
