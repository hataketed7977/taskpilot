package ai.taskpilot.coreapi.access.api

import ai.taskpilot.contract.generated.api.FederatedAuthenticationApi
import ai.taskpilot.contract.generated.model.AuthenticationCapabilitiesResponse
import ai.taskpilot.contract.generated.model.FederatedAttemptRequest
import ai.taskpilot.contract.generated.model.FederatedAttemptResponse
import ai.taskpilot.contract.generated.model.FederatedAttemptSecretRequest
import ai.taskpilot.contract.generated.model.FederatedBootstrapResponse
import ai.taskpilot.contract.generated.model.FederatedPollRequest
import ai.taskpilot.contract.generated.model.FederatedPollResponse
import ai.taskpilot.contract.generated.model.FederatedRegistrationRequest
import ai.taskpilot.contract.generated.model.GitHubCapabilityResponse
import ai.taskpilot.contract.generated.model.RegistrationPreviewResponse
import ai.taskpilot.coreapi.AuthenticationProblemException
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
import ai.taskpilot.coreapi.currentHttpRequest
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.security.SecureRandom
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID

@RestController
@ConditionalOnProperty(prefix = "taskpilot.authentication", name = ["enabled"], havingValue = "true")
class FederatedAuthenticationController(
    private val service: FederatedAuthenticationService,
) : FederatedAuthenticationApi {
    override fun capabilities(): ResponseEntity<AuthenticationCapabilitiesResponse> =
        ResponseEntity.ok(AuthenticationCapabilitiesResponse(GitHubCapabilityResponse(service.capabilityEnabled())))

    override fun createAttempt(federatedAttemptRequest: FederatedAttemptRequest): ResponseEntity<FederatedAttemptResponse> =
        mapFailures {
            val completionUri =
                try {
                    URI.create(federatedAttemptRequest.completionUri)
                } catch (failure: IllegalArgumentException) {
                    throw IllegalArgumentException("completionUri", failure)
                }
            require(FederatedAuthenticationInputPolicy.validCompletionUri(completionUri)) { "completionUri" }
            val created =
                service.createAttempt(
                    CreateFederatedAttemptCommand(
                        federatedAttemptRequest.provider.value,
                        federatedAttemptRequest.installationId,
                        completionUri,
                        currentHttpRequest().remoteAddr,
                    ),
                )
            ResponseEntity.status(HttpStatus.CREATED).body(
                FederatedAttemptResponse(
                    created.attemptId.value,
                    created.pollSecret,
                    created.authorizationUrl,
                    created.expiresAt.atOffset(ZoneOffset.UTC),
                ),
            )
        }

    override fun callback(
        state: String,
        code: String?,
        error: String?,
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

    override fun poll(
        attemptId: UUID,
        federatedPollRequest: FederatedPollRequest,
    ): ResponseEntity<FederatedPollResponse> =
        mapFailures {
            AuthenticationWireInputPolicy.pollSecret(federatedPollRequest.pollSecret)
            ResponseEntity.ok(
                service
                    .poll(
                        PollFederatedAttemptCommand(
                            AttemptId(attemptId),
                            federatedPollRequest.pollSecret,
                            federatedPollRequest.completionProof,
                        ),
                    ).toWireResponse(),
            )
        }

    override fun cancel(
        attemptId: UUID,
        federatedAttemptSecretRequest: FederatedAttemptSecretRequest,
    ): ResponseEntity<Unit> =
        mapFailures {
            AuthenticationWireInputPolicy.pollSecret(federatedAttemptSecretRequest.pollSecret)
            service.cancel(AttemptId(attemptId), federatedAttemptSecretRequest.pollSecret)
            ResponseEntity.noContent().build()
        }

    override fun register(federatedRegistrationRequest: FederatedRegistrationRequest): ResponseEntity<FederatedPollResponse> =
        mapFailures {
            AuthenticationWireInputPolicy.registration(
                federatedRegistrationRequest.continuationSecret,
                federatedRegistrationRequest.legalBundleVersion,
                federatedRegistrationRequest.termsVersion,
                federatedRegistrationRequest.privacyVersion,
                federatedRegistrationRequest.locale,
            )
            val result =
                service.register(
                    RegisterFederatedUserCommand(
                        ContinuationId(federatedRegistrationRequest.continuationId),
                        federatedRegistrationRequest.continuationSecret,
                        federatedRegistrationRequest.displayName,
                        requireNotNull(federatedRegistrationRequest.useSuggestedAvatar),
                        federatedRegistrationRequest.legalBundleVersion,
                        federatedRegistrationRequest.termsVersion,
                        federatedRegistrationRequest.privacyVersion,
                        federatedRegistrationRequest.locale,
                    ),
                )
            ResponseEntity.status(HttpStatus.CREATED).body(result.toWireResponse())
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
                    it in setOf("provider", "installationId", "completionUri", "displayName")
                }
            throw AuthenticationProblemException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", path, cause = failure)
        }
}

private fun FederatedPollResult.toWireResponse(): FederatedPollResponse =
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
            FederatedPollResponse(
                "AUTHENTICATED",
                session = session.toWireResponse(),
                bootstrap = bootstrap?.let { FederatedBootstrapResponse(it.workspaceId, it.projectId) },
            )
        }

        is FederatedPollResult.RegistrationRequired -> {
            FederatedPollResponse(
                "REGISTRATION_REQUIRED",
                registration =
                    RegistrationPreviewResponse(
                        continuationId,
                        continuationSecret,
                        suggestedDisplayName,
                        legalBundleVersion,
                        termsVersion,
                        privacyVersion,
                        legalLocales,
                        expiresAt.atOffset(ZoneOffset.UTC),
                        suggestedAvatarUrl,
                    ),
            )
        }
    }

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
