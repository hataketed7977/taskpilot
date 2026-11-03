package ai.taskpilot.gateway.route

import org.springframework.core.io.Resource
import org.springframework.http.HttpMethod
import org.springframework.http.server.PathContainer
import org.springframework.web.util.pattern.PathPattern
import org.springframework.web.util.pattern.PathPatternParser
import org.springframework.web.util.pattern.PatternParseException
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

private val supportedMethods =
    setOf(HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE)
private val supportedIngress = setOf("canonical", "provider-callback")
private val operationIdPattern = Regex("^[A-Za-z][A-Za-z0-9]*$")
private val manifestFields = setOf("method", "path", "operationId", "ingress")

class CanonicalRoute internal constructor(
    val method: HttpMethod,
    val path: String,
    val operationId: String,
    val ingress: String,
    private val pattern: PathPattern = PathPatternParser.defaultInstance.parse(path),
) {
    fun matches(
        candidateMethod: HttpMethod,
        candidatePath: String,
    ): Boolean = method == candidateMethod && pattern.matches(PathContainer.parsePath(candidatePath))
}

class RouteCatalog private constructor(
    routes: List<CanonicalRoute>,
) {
    val routes: List<CanonicalRoute> = routes.toList()

    fun contains(
        method: HttpMethod,
        path: String,
    ): Boolean = routes.any { it.matches(method, path) }

    companion object {
        fun load(
            resource: Resource,
            objectMapper: ObjectMapper,
        ): RouteCatalog {
            val root =
                try {
                    resource.inputStream.use(objectMapper::readTree)
                } catch (exception: java.io.IOException) {
                    throw IllegalStateException("Cannot load canonical route manifest", exception)
                } catch (exception: JacksonException) {
                    throw IllegalStateException("Cannot load canonical route manifest", exception)
                }
            require(root.isArray && !root.isEmpty) { "Canonical route manifest must be a non-empty array" }
            val routes = root.mapIndexed(::parseRoute)
            require(routes.map { it.method to it.path }.toSet().size == routes.size) {
                "Canonical route manifest contains duplicate method/path entries"
            }
            require(routes.map(CanonicalRoute::operationId).toSet().size == routes.size) {
                "Canonical route manifest contains duplicate operationId entries"
            }
            return RouteCatalog(routes)
        }

        private fun parseRoute(
            index: Int,
            node: JsonNode,
        ): CanonicalRoute {
            require(node.isObject) { "Canonical route manifest entry $index must be an object" }
            val fields = node.propertyNames().toSet()
            require(fields == manifestFields) {
                "Canonical route manifest entry $index must contain exactly $manifestFields"
            }
            val methodName = requiredText(node, "method", index)
            val method = runCatching { HttpMethod.valueOf(methodName) }.getOrNull()
            require(method != null && method in supportedMethods) {
                "Unsupported route method '$methodName' at entry $index"
            }

            val path = requiredText(node, "path", index)
            require(path.startsWith("/v1/") && path.none(Char::isWhitespace)) {
                "Invalid canonical route path '$path' at entry $index"
            }
            require('?' !in path && '#' !in path && '*' !in path) {
                "Invalid canonical route path '$path' at entry $index"
            }
            val pattern =
                try {
                    PathPatternParser.defaultInstance.parse(path)
                } catch (exception: PatternParseException) {
                    throw IllegalArgumentException("Invalid canonical route path '$path' at entry $index", exception)
                }

            val operationId = requiredText(node, "operationId", index)
            require(operationIdPattern.matches(operationId)) {
                "Invalid operationId '$operationId' at entry $index"
            }
            val ingress = requiredText(node, "ingress", index)
            require(ingress in supportedIngress) { "Unsupported ingress '$ingress' at entry $index" }
            return CanonicalRoute(method, path, operationId, ingress, pattern)
        }

        private fun requiredText(
            node: JsonNode,
            field: String,
            index: Int,
        ): String {
            val value = node[field]
            require(value != null && value.isString && value.stringValue().isNotBlank()) {
                "Canonical route manifest entry $index has invalid '$field'"
            }
            return value.stringValue()
        }
    }
}
