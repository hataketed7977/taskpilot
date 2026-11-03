package ai.taskpilot.coreapi

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.io.ClassPathResource
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.yaml.snakeyaml.LoaderOptions
import org.yaml.snakeyaml.Yaml
import org.yaml.snakeyaml.constructor.SafeConstructor

private const val CANONICAL_OPEN_API_RESOURCE = "canonical-api/openapi.yaml"
private const val MAX_YAML_NESTING_DEPTH = 100
private const val MAX_OPEN_API_CODE_POINTS = 2_000_000

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = ["springdoc.api-docs.enabled"], havingValue = "true", matchIfMissing = true)
class OpenApiConfiguration {
    @Bean
    fun canonicalOpenApiDocument(): CanonicalOpenApiDocument = CanonicalOpenApiDocument.load(CANONICAL_OPEN_API_RESOURCE)
}

@RestController
@ConditionalOnProperty(name = ["springdoc.api-docs.enabled"], havingValue = "true", matchIfMissing = true)
class CanonicalOpenApiController(
    private val document: CanonicalOpenApiDocument,
) {
    @GetMapping("/v3/api-docs", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun openApi(): Map<String, Any?> = document.content
}

class CanonicalOpenApiDocument private constructor(
    val content: Map<String, Any?>,
) {
    companion object {
        fun load(resourcePath: String): CanonicalOpenApiDocument {
            val options =
                LoaderOptions().apply {
                    isAllowDuplicateKeys = false
                    maxAliasesForCollections = 0
                    nestingDepthLimit = MAX_YAML_NESTING_DEPTH
                    codePointLimit = MAX_OPEN_API_CODE_POINTS
                }
            val loaded =
                ClassPathResource(resourcePath).inputStream.bufferedReader().use { reader ->
                    Yaml(SafeConstructor(options)).load<Any?>(reader)
                }
            return CanonicalOpenApiDocument(stringKeyedMap(loaded, "OpenAPI document"))
        }

        private fun stringKeyedMap(
            value: Any?,
            context: String,
        ): Map<String, Any?> {
            val source = value as? Map<*, *> ?: error("$context must be a mapping")
            return source.mapKeys { (key, _) -> key as? String ?: error("$context contains a non-string key") }
        }
    }
}
