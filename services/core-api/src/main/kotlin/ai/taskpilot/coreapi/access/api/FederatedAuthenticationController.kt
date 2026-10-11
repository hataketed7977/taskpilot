package ai.taskpilot.coreapi.access.api

import ai.taskpilot.coreapi.access.application.CreateFederatedAttemptCommand
import ai.taskpilot.coreapi.access.application.FederatedAttemptExpired
import ai.taskpilot.coreapi.access.application.FederatedAuthenticationInputPolicy
import ai.taskpilot.coreapi.access.application.FederatedAuthenticationService
import ai.taskpilot.coreapi.access.application.FederatedCallbackCommand
import ai.taskpilot.coreapi.access.application.FederatedContextInvalid
import ai.taskpilot.coreapi.access.application.FederatedLegalBundleRejected
import ai.taskpilot.coreapi.access.application.FederatedPollResult
import ai.taskpilot.coreapi.access.application.FederatedProviderFailure
import ai.taskpilot.coreapi.access.application.FederatedProviderFailureCategory
import ai.taskpilot.coreapi.access.application.FederatedRateLimited
import ai.taskpilot.coreapi.access.application.FederatedUnavailable
import ai.taskpilot.coreapi.access.application.PollFederatedAttemptCommand
import ai.taskpilot.coreapi.access.application.RegisterFederatedUserCommand
import ai.taskpilot.coreapi.access.model.AttemptId
import ai.taskpilot.coreapi.access.model.ContinuationId
import io.swagger.v3.oas.annotations.media.Schema
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Size
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID

@RestController
@RequestMapping("/desktop/v1/auth")
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class FederatedAuthenticationController(
    private val service: FederatedAuthenticationService,
) {
    @GetMapping("/capabilities")
    fun capabilities() = AuthenticationCapabilitiesResponse(GitHubCapabilityResponse(service.capabilityEnabled()))

    @PostMapping("/federated/attempts")
    fun createAttempt(
        @Valid @RequestBody body: FederatedAttemptRequest,
        request: HttpServletRequest,
    ): ResponseEntity<FederatedAttemptResponse> =
        mapFailures {
            val completionUri =
                try {
                    URI.create(body.completionUri)
                } catch (failure: IllegalArgumentException) {
                    throw IllegalArgumentException("completionUri", failure)
                }
            require(FederatedAuthenticationInputPolicy.validCompletionUri(completionUri)) { "completionUri" }
            val created =
                service.createAttempt(
                    CreateFederatedAttemptCommand(
                        body.provider,
                        body.installationId,
                        completionUri,
                        request.remoteAddr,
                    ),
                )
            ResponseEntity
                .status(
                    HttpStatus.CREATED,
                ).body(
                    FederatedAttemptResponse(
                        created.attemptId.value,
                        created.pollSecret,
                        created.authorizationUrl,
                        created.expiresAt,
                    ),
                )
        }

    @GetMapping("/federated/github/callback", produces = [MediaType.TEXT_HTML_VALUE])
    fun callback(
        @RequestParam(required = false) code: String?,
        @RequestParam state: String,
        @RequestParam(required = false) error: String?,
    ): ResponseEntity<String> =
        mapFailures {
            val result = service.completeCallback(FederatedCallbackCommand(state, code, error == "access_denied"))
            val nonce = cspNonce()
            val connectOrigin = "${result.completionUri.scheme}://${result.completionUri.host}:${result.completionUri.port}"
            ResponseEntity
                .ok()
                .cacheControl(CacheControl.noStore())
                .header("Referrer-Policy", "no-referrer")
                .header("X-Content-Type-Options", "nosniff")
                .header(
                    "Content-Security-Policy",
                    "default-src 'none'; script-src 'nonce-$nonce'; connect-src $connectOrigin; " +
                        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
                ).contentType(MediaType.TEXT_HTML)
                .body(completionPage(result.completionUri, result.completionProof, nonce))
        }

    @PostMapping("/federated/attempts/{attemptId}/poll")
    fun poll(
        @PathVariable attemptId: UUID,
        @Valid @RequestBody body: FederatedPollRequest,
    ): FederatedPollResponse =
        mapFailures {
            service
                .poll(
                    PollFederatedAttemptCommand(AttemptId(attemptId), body.pollSecret, body.completionProof),
                ).toResponse()
        }

    @PostMapping("/federated/attempts/{attemptId}/cancel")
    fun cancel(
        @PathVariable attemptId: UUID,
        @Valid @RequestBody body: FederatedAttemptSecretRequest,
    ): ResponseEntity<Void> =
        mapFailures {
            service.cancel(AttemptId(attemptId), body.pollSecret)
            ResponseEntity.noContent().build()
        }

    @PostMapping("/federated/registrations")
    fun register(
        @Valid @RequestBody body: FederatedRegistrationRequest,
    ): ResponseEntity<FederatedPollResponse> =
        mapFailures {
            val result =
                service.register(
                    RegisterFederatedUserCommand(
                        ContinuationId(body.continuationId),
                        body.continuationSecret,
                        body.displayName,
                        requireNotNull(body.useSuggestedAvatar),
                        body.legalBundleVersion,
                        body.termsVersion,
                        body.privacyVersion,
                        body.locale,
                    ),
                )
            ResponseEntity.status(HttpStatus.CREATED).body(result.toResponse())
        }

    private fun <T> mapFailures(block: () -> T): T =
        try {
            block()
        } catch (failure: FederatedRateLimited) {
            throw AuthenticationProblemException(
                HttpStatus.TOO_MANY_REQUESTS,
                "AUTHENTICATION_RATE_LIMITED",
                retryAfterSeconds = failure.retryAfterSeconds,
                cause = failure,
            )
        } catch (_: FederatedAttemptExpired) {
            throw AuthenticationProblemException(HttpStatus.GONE, "FEDERATED_LOGIN_EXPIRED")
        } catch (_: FederatedContextInvalid) {
            throw AuthenticationProblemException(HttpStatus.CONFLICT, "FEDERATED_LOGIN_CONTEXT_INVALID")
        } catch (_: FederatedLegalBundleRejected) {
            throw AuthenticationProblemException(HttpStatus.CONFLICT, "LEGAL_BUNDLE_REJECTED", "legalBundleVersion")
        } catch (failure: FederatedUnavailable) {
            throw AuthenticationProblemException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "AUTHENTICATION_TEMPORARILY_UNAVAILABLE",
                cause = failure,
            )
        } catch (failure: FederatedProviderFailure) {
            val unavailable = failure.category == FederatedProviderFailureCategory.TEMPORARILY_UNAVAILABLE
            throw AuthenticationProblemException(
                if (unavailable) HttpStatus.SERVICE_UNAVAILABLE else HttpStatus.CONFLICT,
                if (unavailable) "AUTHENTICATION_TEMPORARILY_UNAVAILABLE" else "FEDERATED_LOGIN_CONTEXT_INVALID",
                cause = failure,
            )
        } catch (failure: IllegalArgumentException) {
            val path =
                failure.message?.takeIf {
                    it in
                        setOf("provider", "installationId", "completionUri", "displayName")
                }
            throw AuthenticationProblemException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", path, cause = failure)
        }
}

private fun FederatedPollResult.toResponse(): FederatedPollResponse =
    when (this) {
        FederatedPollResult.Waiting -> {
            FederatedPollResponse("WAITING")
        }

        FederatedPollResult.CompletionRequired -> {
            FederatedPollResponse("COMPLETION_REQUIRED")
        }

        FederatedPollResult.Denied -> {
            FederatedPollResponse("DENIED")
        }

        FederatedPollResult.Cancelled -> {
            FederatedPollResponse("CANCELLED")
        }

        FederatedPollResult.Failed -> {
            FederatedPollResponse("FAILED")
        }

        FederatedPollResult.Completed -> {
            FederatedPollResponse("COMPLETED")
        }

        is FederatedPollResult.Authenticated -> {
            FederatedPollResponse("AUTHENTICATED", session = SessionResponse.from(session))
        }

        is FederatedPollResult.RegistrationRequired -> {
            FederatedPollResponse(
                "REGISTRATION_REQUIRED",
                RegistrationPreviewResponse(
                    continuationId,
                    continuationSecret,
                    suggestedDisplayName,
                    suggestedAvatarUrl,
                    legalBundleVersion,
                    expiresAt,
                ),
            )
        }
    }

data class AuthenticationCapabilitiesResponse(
    val github: GitHubCapabilityResponse,
)

data class GitHubCapabilityResponse(
    val enabled: Boolean,
)

data class FederatedAttemptRequest(
    @field:NotBlank @field:Schema(allowableValues = ["github"]) val provider: String,
    @field:NotBlank @field:Size(max = 200) @field:Schema(pattern = "^[A-Za-z0-9_.:-]+$") val installationId: String,
    @field:NotBlank @field:Size(max = 2048) @field:Schema(pattern = COMPLETION_URI_OPENAPI_PATTERN) val completionUri: String,
)

data class FederatedAttemptResponse(
    val attemptId: UUID,
    val pollSecret: String,
    val authorizationUrl: URI,
    val expiresAt: java.time.Instant,
)

data class FederatedPollRequest(
    @field:NotBlank val pollSecret: String,
    val completionProof: String? = null,
)

data class FederatedPollResponse(
    val status: String,
    val registration: RegistrationPreviewResponse? = null,
    val session: SessionResponse? = null,
)

data class RegistrationPreviewResponse(
    val continuationId: UUID,
    val continuationSecret: String,
    val suggestedDisplayName: String,
    val suggestedAvatarUrl: URI?,
    val legalBundleVersion: String,
    val expiresAt: java.time.Instant,
)

data class FederatedRegistrationRequest(
    val continuationId: UUID,
    @field:NotBlank @field:Size(max = 512) val continuationSecret: String,
    @field:NotBlank @field:Size(max = 200) val displayName: String,
    @field:NotNull val useSuggestedAvatar: Boolean?,
    @field:NotBlank @field:Size(max = 128) val legalBundleVersion: String,
    @field:NotBlank @field:Size(max = 128) val termsVersion: String,
    @field:NotBlank @field:Size(max = 128) val privacyVersion: String,
    @field:NotBlank @field:Size(max = 35) val locale: String,
)

data class FederatedAttemptSecretRequest(
    @field:NotBlank val pollSecret: String,
)

private const val COMPLETION_URI_OPENAPI_PATTERN =
    "^http://127\\.0\\.0\\.1:(?:49(?:15[2-9]|1[6-9][0-9]|[2-9][0-9]{2})|5[0-9]{4}|" +
        "6(?:[0-4][0-9]{3}|5(?:[0-4][0-9]{2}|5(?:[0-2][0-9]|3[0-5]))))/taskpilot/oauth/complete/" +
        "[A-Za-z0-9_-]{32,128}$"

private fun completionPage(
    completionUri: URI,
    proof: String?,
    nonce: String,
): String {
    val target = completionUri.toASCIIString()
    val safeProof = proof.orEmpty()
    val denied = proof == null
    return """
        <!doctype html>
        <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <meta name="referrer" content="no-referrer">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>TaskPilot 登录</title>
        </head>
        <body>
          <main>
            <h1>TaskPilot 登录</h1>
            <p id="status" role="status" aria-live="polite">${if (denied) "已取消 GitHub 授权，请返回 TaskPilot。" else "正在返回 TaskPilot…"}</p>
            <p id="fallback" hidden>授权已完成，可以关闭此页面。</p>
            <button id="retry" type="button" hidden>重新返回 TaskPilot</button>
          </main>
          <script nonce="$nonce">
            history.replaceState(null, '', location.pathname);
            const proof = "$safeProof";
            const target = "$target";
            const status = document.getElementById('status');
            const fallback = document.getElementById('fallback');
            const retry = document.getElementById('retry');
            async function deliver() {
              retry.hidden = true;
              status.textContent = '正在返回 TaskPilot…';
              try {
                const response = await fetch(target, {
                  method: "POST",
                  headers: {"Content-Type":"text/plain;charset=UTF-8"},
                  body: JSON.stringify({completionProof: proof}),
                  referrerPolicy: "no-referrer",
                  credentials: "omit"
                });
                if (!response.ok) throw new Error('Loopback delivery failed');
                status.textContent = '授权已完成，可以关闭此页面。';
                fallback.hidden = false;
                window.close();
              } catch (_) {
                status.textContent = '无法自动返回 TaskPilot，请确认应用仍在运行后重试。';
                fallback.hidden = true;
                retry.hidden = false;
              }
            }
            retry.addEventListener('click', deliver);
            if (proof) void deliver();
          </script>
        </body>
        </html>
        """.trimIndent()
}

private fun cspNonce(): String {
    val bytes = ByteArray(CSP_NONCE_BYTE_LENGTH)
    CSP_RANDOM.nextBytes(bytes)
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}

private const val CSP_NONCE_BYTE_LENGTH = 18
private val CSP_RANDOM = SecureRandom()
