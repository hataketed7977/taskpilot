package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.AttemptId
import ai.taskpilot.coreapi.access.model.ContinuationId
import ai.taskpilot.coreapi.access.model.ExternalIdentity
import ai.taskpilot.coreapi.access.model.ExternalIdentityId
import ai.taskpilot.coreapi.access.model.FederatedCallbackClaim
import ai.taskpilot.coreapi.access.model.FederatedLoginAttempt
import ai.taskpilot.coreapi.access.model.FederatedLoginAttemptStatus
import ai.taskpilot.coreapi.access.model.FederatedUserProfile
import ai.taskpilot.coreapi.access.model.NewFederatedUser
import ai.taskpilot.coreapi.access.model.TermsAcceptance
import ai.taskpilot.coreapi.access.model.TermsAcceptanceId
import ai.taskpilot.coreapi.access.model.UserAccount
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.UserStatus
import java.net.URI
import java.security.GeneralSecurityException
import java.time.Duration
import java.time.Instant
import java.util.UUID

@Suppress("TooManyFunctions")
class FederatedAuthenticationService(
    private val store: FederatedLoginStore,
    private val identities: FederatedIdentityStore,
    private val rateLimits: FederatedAttemptRateLimiter,
    private val sessions: SessionUseCases,
    private val dependencies: FederatedAuthenticationDependencies,
) {
    fun capabilityEnabled(): Boolean = dependencies.capabilityEnabled()

    fun createAttempt(command: CreateFederatedAttemptCommand): FederatedAttemptCreated {
        requireEnabled()
        require(command.provider == PROVIDER) { "provider" }
        require(FederatedAuthenticationInputPolicy.validInstallationId(command.installationId)) { "installationId" }
        require(FederatedAuthenticationInputPolicy.validCompletionUri(command.completionUri)) { "completionUri" }
        val now = dependencies.clock.instant()
        rateLimits
            .acquire(command.sourceNetwork, command.installationId, now, ATTEMPT_RATE_WINDOW, ATTEMPT_RATE_MAXIMUM)
            ?.let { throw FederatedRateLimited(it) }

        val attemptId = AttemptId(UUID.randomUUID())
        val pollSecret = dependencies.security.newSecret()
        val state = dependencies.security.newSecret()
        val verifier = dependencies.security.newPkceVerifier()
        val expiresAt = now.plus(ATTEMPT_TTL)
        store.createAttempt(
            FederatedLoginAttempt(
                attemptId,
                PROVIDER,
                command.installationId,
                command.completionUri,
                dependencies.security.digest(FederatedSecretPurpose.POLL, pollSecret),
                dependencies.security.digest(FederatedSecretPurpose.OAUTH_STATE, state),
                dependencies.codec.encryptPkceVerifier(attemptId, verifier),
                FederatedLoginAttemptStatus.PENDING,
                now,
                expiresAt,
            ),
        )
        return FederatedAttemptCreated(
            attemptId,
            pollSecret,
            dependencies.provider.authorizationUri(state, dependencies.security.pkceS256(verifier)),
            expiresAt,
        )
    }

    fun completeCallback(command: FederatedCallbackCommand): FederatedCallbackResult {
        requireEnabled()
        val now = dependencies.clock.instant()
        val claim =
            store.claimCallbackByState(
                dependencies.security.digest(FederatedSecretPurpose.OAUTH_STATE, command.state),
                now,
            ) ?: throw FederatedContextInvalid()
        if (command.denied) {
            store.finishCallback(claim.attemptId, FederatedLoginAttemptStatus.DENIED, now)
            return FederatedCallbackResult(claim.completionUri, null, FederatedLoginAttemptStatus.DENIED)
        }
        val code =
            command.authorizationCode?.takeIf(String::isNotBlank) ?: run {
                store.finishCallback(claim.attemptId, FederatedLoginAttemptStatus.FAILED, now)
                throw FederatedContextInvalid()
            }
        val verifier = decryptPkceVerifier(claim, now)
        val identity =
            try {
                dependencies.provider.resolveIdentity(code, verifier)
            } catch (failure: FederatedProviderFailure) {
                val status =
                    if (failure.category == FederatedProviderFailureCategory.AUTHORIZATION_REJECTED) {
                        FederatedLoginAttemptStatus.DENIED
                    } else {
                        FederatedLoginAttemptStatus.FAILED
                    }
                store.finishCallback(claim.attemptId, status, dependencies.clock.instant())
                throw failure
            }
        if (identity.provider != PROVIDER) {
            store.finishCallback(claim.attemptId, FederatedLoginAttemptStatus.FAILED, dependencies.clock.instant())
            throw FederatedContextInvalid()
        }
        val proof = dependencies.security.newSecret()
        if (!store.completeCallback(
                claim.attemptId,
                dependencies.codec.encryptIdentity(claim.attemptId, identity),
                dependencies.security.digest(FederatedSecretPurpose.COMPLETION, proof),
                dependencies.clock.instant(),
            )
        ) {
            throw FederatedContextInvalid()
        }
        return FederatedCallbackResult(claim.completionUri, proof, FederatedLoginAttemptStatus.COMPLETION_PENDING)
    }

    fun poll(command: PollFederatedAttemptCommand): FederatedPollResult {
        requireEnabled()
        val now = dependencies.clock.instant()
        val pollDigest = dependencies.security.digest(FederatedSecretPurpose.POLL, command.pollSecret)
        val view = store.findAttemptForPoll(command.attemptId, pollDigest, now) ?: throw FederatedContextInvalid()
        return when (view.status) {
            FederatedLoginAttemptStatus.PENDING,
            FederatedLoginAttemptStatus.CALLBACK_PROCESSING,
            FederatedLoginAttemptStatus.IDENTITY_PROCESSING,
            FederatedLoginAttemptStatus.REGISTRATION_PROCESSING,
            -> {
                FederatedPollResult.Waiting
            }

            FederatedLoginAttemptStatus.COMPLETION_PENDING -> {
                claimIdentity(command, pollDigest)
            }

            FederatedLoginAttemptStatus.REGISTRATION_PENDING -> {
                registrationResult(
                    command.attemptId,
                    view.encryptedResult,
                )
            }

            FederatedLoginAttemptStatus.DENIED -> {
                FederatedPollResult.Denied
            }

            FederatedLoginAttemptStatus.CANCELLED -> {
                FederatedPollResult.Cancelled
            }

            FederatedLoginAttemptStatus.EXPIRED -> {
                throw FederatedAttemptExpired()
            }

            FederatedLoginAttemptStatus.FAILED -> {
                FederatedPollResult.Failed
            }

            FederatedLoginAttemptStatus.COMPLETED -> {
                authenticatedResult(command.attemptId, view.encryptedResult)
            }
        }
    }

    fun cancel(
        attemptId: AttemptId,
        pollSecret: String,
    ) {
        requireEnabled()
        val digest = dependencies.security.digest(FederatedSecretPurpose.POLL, pollSecret)
        if (!store.cancel(attemptId, digest, dependencies.clock.instant())) {
            val status = store.findAttemptForPoll(attemptId, digest, dependencies.clock.instant())?.status
            if (status != FederatedLoginAttemptStatus.CANCELLED) throw FederatedContextInvalid()
        }
    }

    fun register(command: RegisterFederatedUserCommand): FederatedPollResult.Authenticated {
        requireEnabled()
        val submitted =
            LegalDocumentBundle(
                command.legalBundleVersion,
                command.termsVersion,
                command.privacyVersion,
                command.locale,
            )
        if (submitted != dependencies.currentLegalBundle) throw FederatedLegalBundleRejected()
        val now = dependencies.clock.instant()
        val claim =
            store.claimRegistration(
                command.continuationId,
                dependencies.security.digest(
                    FederatedSecretPurpose.REGISTRATION_CONTINUATION,
                    command.continuationSecret,
                ),
                now,
            ) ?: throw FederatedContextInvalid()
        var finalized = false
        var issuedSession: IssuedSession? = null
        try {
            val identity = dependencies.codec.readIdentity(claim.attemptId, claim.encryptedIdentityCandidate)
            val displayName =
                command.displayName.trim().takeIf(String::isNotBlank) ?: throw IllegalArgumentException("displayName")
            val avatarUrl = if (command.useSuggestedAvatar) identity.suggestedAvatarUrl else null
            val userId = UserId(UUID.randomUUID())
            val registration =
                NewFederatedUser(
                    UserAccount(userId, displayName, UserStatus.ACTIVE, now, avatarUrl),
                    ExternalIdentity(ExternalIdentityId(UUID.randomUUID()), userId, identity.key(), now, now),
                    TermsAcceptance(
                        TermsAcceptanceId(UUID.randomUUID()),
                        userId,
                        command.legalBundleVersion,
                        command.termsVersion,
                        command.privacyVersion,
                        command.locale,
                        now,
                    ),
                )
            val user =
                try {
                    identities.register(registration)
                    SessionUser(userId, displayName, avatarUrl)
                } catch (_: ExternalIdentityAlreadyExistsException) {
                    val existing =
                        identities.findUser(identity.key())?.takeIf { it.status == UserStatus.ACTIVE }
                            ?: throw FederatedContextInvalid()
                    existing.toSessionUser()
                }
            val session = sessions.issue(user)
            issuedSession = session
            val encrypted = dependencies.codec.encryptAuthenticatedResult(claim.attemptId, session.toPayload())
            if (!store.complete(
                    claim.attemptId,
                    encrypted,
                    dependencies.clock.instant(),
                )
            ) {
                throw FederatedContextInvalid()
            }
            finalized = true
            return FederatedPollResult.Authenticated(session)
        } finally {
            if (!finalized) {
                issuedSession?.let { runCatching { sessions.logout(it.accessToken) } }
                runCatching { store.releaseRegistration(claim.attemptId, dependencies.clock.instant()) }
            }
        }
    }

    private fun claimIdentity(
        command: PollFederatedAttemptCommand,
        pollDigest: String,
    ): FederatedPollResult {
        val proof = command.completionProof?.takeIf(String::isNotBlank) ?: return FederatedPollResult.CompletionRequired
        val view =
            store.claimIdentity(
                command.attemptId,
                pollDigest,
                dependencies.security.digest(FederatedSecretPurpose.COMPLETION, proof),
                dependencies.clock.instant(),
            ) ?: throw FederatedContextInvalid()
        var finalized = false
        var issuedSession: IssuedSession? = null
        try {
            val encryptedIdentity = view.encryptedIdentityCandidate ?: throw FederatedContextInvalid()
            val identity = dependencies.codec.readIdentity(command.attemptId, encryptedIdentity)
            val existing = identities.findUser(identity.key())
            if (existing != null) {
                if (existing.status != UserStatus.ACTIVE) throw FederatedContextInvalid()
                val session = sessions.issue(existing.toSessionUser())
                issuedSession = session
                val encrypted = dependencies.codec.encryptAuthenticatedResult(command.attemptId, session.toPayload())
                if (!store.complete(
                        command.attemptId,
                        encrypted,
                        dependencies.clock.instant(),
                    )
                ) {
                    throw FederatedContextInvalid()
                }
                finalized = true
                return FederatedPollResult.Authenticated(session)
            }

            val continuationId = ContinuationId(UUID.randomUUID())
            val continuationSecret = dependencies.security.newSecret()
            val result =
                FederatedRegistrationResultPayload(
                    continuationId.value,
                    continuationSecret,
                    identity.suggestedDisplayName,
                    identity.suggestedAvatarUrl,
                    dependencies.currentLegalBundle.legalBundleVersion,
                    dependencies.clock.instant().plus(REGISTRATION_TTL),
                )
            if (!store.requireRegistration(
                    command.attemptId,
                    continuationId,
                    dependencies.security.digest(FederatedSecretPurpose.REGISTRATION_CONTINUATION, continuationSecret),
                    dependencies.codec.encryptRegistrationResult(command.attemptId, result),
                    dependencies.clock.instant(),
                )
            ) {
                throw FederatedContextInvalid()
            }
            finalized = true
            return result.toPollResult()
        } finally {
            if (!finalized) {
                issuedSession?.let { runCatching { sessions.logout(it.accessToken) } }
                runCatching { store.releaseIdentity(command.attemptId, dependencies.clock.instant()) }
            }
        }
    }

    private fun registrationResult(
        attemptId: AttemptId,
        encrypted: ByteArray?,
    ): FederatedPollResult =
        encrypted?.let { dependencies.codec.readRegistrationResult(attemptId, it).toPollResult() }
            ?: throw FederatedContextInvalid()

    private fun authenticatedResult(
        attemptId: AttemptId,
        encrypted: ByteArray?,
    ): FederatedPollResult =
        encrypted?.let {
            FederatedPollResult.Authenticated(dependencies.codec.readAuthenticatedResult(attemptId, it).toSession())
        }
            ?: FederatedPollResult.Completed

    private fun decryptPkceVerifier(
        claim: FederatedCallbackClaim,
        now: Instant,
    ): String =
        try {
            dependencies.codec.decryptPkceVerifier(claim.attemptId, claim.encryptedPkceVerifier)
        } catch (_: IllegalArgumentException) {
            store.finishCallback(claim.attemptId, FederatedLoginAttemptStatus.FAILED, now)
            throw FederatedContextInvalid()
        } catch (_: GeneralSecurityException) {
            store.finishCallback(claim.attemptId, FederatedLoginAttemptStatus.FAILED, now)
            throw FederatedContextInvalid()
        }

    private fun FederatedUserProfile.toSessionUser() = SessionUser(userId, displayName, avatarUrl)

    private fun IssuedSession.toPayload() =
        FederatedAuthenticatedResultPayload(
            sessionId.value,
            familyId.value,
            accessToken,
            accessTokenExpiresAt,
            refreshToken,
            refreshTokenExpiresAt,
            FederatedCurrentUserPayload(currentUser.userId.value, currentUser.displayName, currentUser.avatarUrl),
        )

    private fun requireEnabled() {
        if (!capabilityEnabled()) throw FederatedUnavailable()
    }

    companion object {
        private const val PROVIDER = "github"
        private val ATTEMPT_TTL = Duration.ofMinutes(5)
        private val REGISTRATION_TTL = Duration.ofMinutes(10)
        private val ATTEMPT_RATE_WINDOW = Duration.ofMinutes(1)
        private const val ATTEMPT_RATE_MAXIMUM = 5
    }
}

data class CreateFederatedAttemptCommand(
    val provider: String,
    val installationId: String,
    val completionUri: URI,
    val sourceNetwork: String,
)

data class FederatedAttemptCreated(
    val attemptId: AttemptId,
    val pollSecret: String,
    val authorizationUrl: URI,
    val expiresAt: Instant,
)

data class FederatedCallbackCommand(
    val state: String,
    val authorizationCode: String?,
    val denied: Boolean,
)

data class FederatedCallbackResult(
    val completionUri: URI,
    val completionProof: String?,
    val status: FederatedLoginAttemptStatus,
)

data class RegisterFederatedUserCommand(
    val continuationId: ContinuationId,
    val continuationSecret: String,
    val displayName: String,
    val useSuggestedAvatar: Boolean,
    val legalBundleVersion: String,
    val termsVersion: String,
    val privacyVersion: String,
    val locale: String,
)

data class PollFederatedAttemptCommand(
    val attemptId: AttemptId,
    val pollSecret: String,
    val completionProof: String?,
)

sealed interface FederatedPollResult {
    data object Waiting : FederatedPollResult

    data object CompletionRequired : FederatedPollResult

    data object Denied : FederatedPollResult

    data object Cancelled : FederatedPollResult

    data object Failed : FederatedPollResult

    data object Completed : FederatedPollResult

    data class Authenticated(
        val session: IssuedSession,
    ) : FederatedPollResult

    data class RegistrationRequired(
        val continuationId: UUID,
        val continuationSecret: String,
        val suggestedDisplayName: String,
        val suggestedAvatarUrl: URI?,
        val legalBundleVersion: String,
        val expiresAt: Instant,
    ) : FederatedPollResult
}

class FederatedUnavailable : RuntimeException()

class FederatedContextInvalid : RuntimeException()

class FederatedAttemptExpired : RuntimeException()

class FederatedLegalBundleRejected : RuntimeException()

class FederatedRateLimited(
    val retryAfterSeconds: Long,
) : RuntimeException()
