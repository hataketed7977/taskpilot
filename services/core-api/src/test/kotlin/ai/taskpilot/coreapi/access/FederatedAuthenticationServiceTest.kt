package ai.taskpilot.coreapi.access

import ai.taskpilot.coreapi.access.application.CreateFederatedAttemptCommand
import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.ExternalIdentityAlreadyExistsException
import ai.taskpilot.coreapi.access.application.FederatedAead
import ai.taskpilot.coreapi.access.application.FederatedAttemptExpired
import ai.taskpilot.coreapi.access.application.FederatedAttemptRateLimiter
import ai.taskpilot.coreapi.access.application.FederatedAuthenticationDependencies
import ai.taskpilot.coreapi.access.application.FederatedAuthenticationService
import ai.taskpilot.coreapi.access.application.FederatedCallbackCommand
import ai.taskpilot.coreapi.access.application.FederatedContextInvalid
import ai.taskpilot.coreapi.access.application.FederatedIdentityProvider
import ai.taskpilot.coreapi.access.application.FederatedIdentityStore
import ai.taskpilot.coreapi.access.application.FederatedLegalBundleRejected
import ai.taskpilot.coreapi.access.application.FederatedLoginSecurity
import ai.taskpilot.coreapi.access.application.FederatedLoginStore
import ai.taskpilot.coreapi.access.application.FederatedPollResult
import ai.taskpilot.coreapi.access.application.FederatedProviderFailure
import ai.taskpilot.coreapi.access.application.FederatedProviderFailureCategory
import ai.taskpilot.coreapi.access.application.FederatedRuntimeDependencies
import ai.taskpilot.coreapi.access.application.FederatedTokenGenerator
import ai.taskpilot.coreapi.access.application.IssuedSession
import ai.taskpilot.coreapi.access.application.LegalDocumentBundle
import ai.taskpilot.coreapi.access.application.PollFederatedAttemptCommand
import ai.taskpilot.coreapi.access.application.ProviderIdentity
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.RegisterFederatedUserCommand
import ai.taskpilot.coreapi.access.application.SessionFamilyId
import ai.taskpilot.coreapi.access.application.SessionId
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.access.application.SessionUser
import ai.taskpilot.coreapi.access.model.AttemptId
import ai.taskpilot.coreapi.access.model.ContinuationId
import ai.taskpilot.coreapi.access.model.ExternalIdentityKey
import ai.taskpilot.coreapi.access.model.FederatedAttemptView
import ai.taskpilot.coreapi.access.model.FederatedCallbackClaim
import ai.taskpilot.coreapi.access.model.FederatedLoginAttempt
import ai.taskpilot.coreapi.access.model.FederatedLoginAttemptStatus
import ai.taskpilot.coreapi.access.model.FederatedRegistrationClaim
import ai.taskpilot.coreapi.access.model.FederatedUserProfile
import ai.taskpilot.coreapi.access.model.NewFederatedUser
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.UserStatus
import tools.jackson.databind.json.JsonMapper
import java.net.URI
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull

class FederatedAuthenticationServiceTest {
    private val now = Instant.parse("2026-10-10T10:00:00Z")
    private val store = StubStore()
    private val identities = StubIdentities()
    private val sessions = StubSessions()
    private val provider = StubProvider()
    private val service = service()

    @Test
    fun `known active identity authenticates directly`() {
        val attempt = prepareIdentity()
        identities.user = FederatedUserProfile(UserId(UUID.randomUUID()), "Ada", null, UserStatus.ACTIVE)

        val result = service.poll(PollFederatedAttemptCommand(attempt, "poll", "proof"))

        assertIs<FederatedPollResult.Authenticated>(result)
        assertEquals("Ada", result.session.currentUser.displayName)
        assertEquals(FederatedLoginAttemptStatus.COMPLETED, store.status)
    }

    @Test
    fun `unknown identity requires registration and acceptance creates account and session`() {
        val attempt = prepareIdentity()
        val pending =
            assertIs<FederatedPollResult.RegistrationRequired>(
                service.poll(PollFederatedAttemptCommand(attempt, "poll", "proof")),
            )
        val authenticated =
            assertIs<FederatedPollResult.Authenticated>(
                service.register(
                    RegisterFederatedUserCommand(
                        ContinuationId(pending.continuationId),
                        pending.continuationSecret,
                        "Ada",
                        true,
                        "bundle-v1",
                        "terms-v1",
                        "privacy-v1",
                        "zh-CN",
                    ),
                ),
            )

        assertEquals("Ada", authenticated.session.currentUser.displayName)
        assertNotNull(identities.registration)
        assertEquals(FederatedLoginAttemptStatus.COMPLETED, store.status)
    }

    @Test
    fun `disabled identity and stale legal bundle fail closed`() {
        val attempt = prepareIdentity()
        identities.user = FederatedUserProfile(UserId(UUID.randomUUID()), "Disabled", null, UserStatus.DISABLED)
        assertFailsWith<FederatedContextInvalid> {
            service.poll(PollFederatedAttemptCommand(attempt, "poll", "proof"))
        }

        identities.user = null
        val other = prepareIdentity()
        val pending =
            assertIs<FederatedPollResult.RegistrationRequired>(
                service.poll(PollFederatedAttemptCommand(other, "poll", "proof")),
            )
        assertFailsWith<FederatedLegalBundleRejected> {
            service.register(
                RegisterFederatedUserCommand(
                    ContinuationId(pending.continuationId),
                    pending.continuationSecret,
                    "Ada",
                    false,
                    "old",
                    "terms-v1",
                    "privacy-v1",
                    "zh-CN",
                ),
            )
        }
    }

    @Test
    fun `callback denial malformed code and provider failures terminate safely`() {
        val deniedAttempt = callbackAttempt()
        val denied = service.completeCallback(FederatedCallbackCommand("state", null, true))
        assertEquals(deniedAttempt, store.created?.attemptId)
        assertEquals(FederatedLoginAttemptStatus.DENIED, denied.status)

        callbackAttempt()
        assertFailsWith<FederatedContextInvalid> {
            service.completeCallback(FederatedCallbackCommand("state", " ", false))
        }
        assertEquals(FederatedLoginAttemptStatus.FAILED, store.status)

        callbackAttempt()
        provider.failure = FederatedProviderFailure(FederatedProviderFailureCategory.AUTHORIZATION_REJECTED)
        assertFailsWith<FederatedProviderFailure> {
            service.completeCallback(FederatedCallbackCommand("state", "code", false))
        }
        assertEquals(FederatedLoginAttemptStatus.DENIED, store.status)

        callbackAttempt()
        provider.failure = FederatedProviderFailure(FederatedProviderFailureCategory.TEMPORARILY_UNAVAILABLE)
        assertFailsWith<FederatedProviderFailure> {
            service.completeCallback(FederatedCallbackCommand("state", "code", false))
        }
        assertEquals(FederatedLoginAttemptStatus.FAILED, store.status)

        callbackAttempt()
        provider.providerName = "google"
        assertFailsWith<FederatedContextInvalid> {
            service.completeCallback(FederatedCallbackCommand("state", "code", false))
        }
        assertEquals(FederatedLoginAttemptStatus.FAILED, store.status)
    }

    @Test
    fun `poll maps every intermediate and terminal state without exposing context`() {
        val attempt =
            service
                .createAttempt(
                    CreateFederatedAttemptCommand("github", "installation", completionUri(), "127.0.0.1"),
                ).attemptId
        val command = PollFederatedAttemptCommand(attempt, "poll", null)

        listOf(
            FederatedLoginAttemptStatus.PENDING,
            FederatedLoginAttemptStatus.CALLBACK_PROCESSING,
            FederatedLoginAttemptStatus.IDENTITY_PROCESSING,
            FederatedLoginAttemptStatus.REGISTRATION_PROCESSING,
        ).forEach { status ->
            store.status = status
            assertIs<FederatedPollResult.Waiting>(service.poll(command))
        }

        store.status = FederatedLoginAttemptStatus.COMPLETION_PENDING
        assertIs<FederatedPollResult.CompletionRequired>(service.poll(command))
        store.status = FederatedLoginAttemptStatus.DENIED
        assertIs<FederatedPollResult.Denied>(service.poll(command))
        store.status = FederatedLoginAttemptStatus.CANCELLED
        assertIs<FederatedPollResult.Cancelled>(service.poll(command))
        store.status = FederatedLoginAttemptStatus.FAILED
        assertIs<FederatedPollResult.Failed>(service.poll(command))
        store.status = FederatedLoginAttemptStatus.EXPIRED
        assertFailsWith<FederatedAttemptExpired> { service.poll(command) }
        store.status = FederatedLoginAttemptStatus.COMPLETED
        store.encryptedResult = null
        assertIs<FederatedPollResult.Completed>(service.poll(command))
        store.status = FederatedLoginAttemptStatus.REGISTRATION_PENDING
        assertFailsWith<FederatedContextInvalid> { service.poll(command) }
    }

    @Test
    fun `completed registration and authentication results remain pollable`() {
        val registrationAttempt = prepareIdentity()
        val pending =
            assertIs<FederatedPollResult.RegistrationRequired>(
                service.poll(PollFederatedAttemptCommand(registrationAttempt, "poll", "proof")),
            )
        assertEquals(
            pending.continuationId,
            assertIs<FederatedPollResult.RegistrationRequired>(
                service.poll(PollFederatedAttemptCommand(registrationAttempt, "poll", null)),
            ).continuationId,
        )
        service.register(registrationCommand(pending))
        assertIs<FederatedPollResult.Authenticated>(
            service.poll(PollFederatedAttemptCommand(registrationAttempt, "poll", null)),
        )
    }

    @Test
    fun `registration race resolves the already bound active identity`() {
        val attempt = prepareIdentity()
        val pending =
            assertIs<FederatedPollResult.RegistrationRequired>(
                service.poll(PollFederatedAttemptCommand(attempt, "poll", "proof")),
            )
        identities.user = FederatedUserProfile(UserId(UUID.randomUUID()), "Existing", null, UserStatus.ACTIVE)
        identities.duplicateOnRegister = true

        val authenticated = service.register(registrationCommand(pending))

        assertEquals("Existing", authenticated.session.currentUser.displayName)
    }

    @Test
    fun `failed finalization revokes issued session and releases processing claim`() {
        val knownAttempt = prepareIdentity()
        identities.user = FederatedUserProfile(UserId(UUID.randomUUID()), "Ada", null, UserStatus.ACTIVE)
        store.completeSucceeds = false
        assertFailsWith<FederatedContextInvalid> {
            service.poll(PollFederatedAttemptCommand(knownAttempt, "poll", "proof"))
        }
        assertEquals(1, sessions.logoutCount)
        assertEquals(1, store.identityReleaseCount)

        store.completeSucceeds = true
        identities.user = null
        val registrationAttempt = prepareIdentity()
        val pending =
            assertIs<FederatedPollResult.RegistrationRequired>(
                service.poll(PollFederatedAttemptCommand(registrationAttempt, "poll", "proof")),
            )
        store.completeSucceeds = false
        assertFailsWith<FederatedContextInvalid> { service.register(registrationCommand(pending)) }
        assertEquals(2, sessions.logoutCount)
        assertEquals(1, store.registrationReleaseCount)
    }

    @Test
    fun `cancel is idempotent only after a confirmed cancellation`() {
        val attempt =
            service
                .createAttempt(
                    CreateFederatedAttemptCommand("github", "installation", completionUri(), "127.0.0.1"),
                ).attemptId
        store.cancelSucceeds = false
        store.status = FederatedLoginAttemptStatus.CANCELLED
        service.cancel(attempt, "poll")

        store.status = FederatedLoginAttemptStatus.FAILED
        assertFailsWith<FederatedContextInvalid> { service.cancel(attempt, "poll") }
        store.findSucceeds = false
        assertFailsWith<FederatedContextInvalid> { service.cancel(attempt, "poll") }
    }

    private fun registrationCommand(pending: FederatedPollResult.RegistrationRequired) =
        RegisterFederatedUserCommand(
            ContinuationId(pending.continuationId),
            pending.continuationSecret,
            "Ada",
            true,
            "bundle-v1",
            "terms-v1",
            "privacy-v1",
            "zh-CN",
        )

    private fun callbackAttempt(): AttemptId {
        provider.failure = null
        provider.providerName = "github"
        val created =
            service.createAttempt(
                CreateFederatedAttemptCommand("github", "installation", completionUri(), "127.0.0.1"),
            )
        store.callbackClaim =
            FederatedCallbackClaim(created.attemptId, completionUri(), store.created!!.encryptedPkceVerifier)
        return created.attemptId
    }

    private fun prepareIdentity(): AttemptId {
        val created =
            service.createAttempt(
                CreateFederatedAttemptCommand("github", "installation", completionUri(), "127.0.0.1"),
            )
        store.callbackClaim =
            FederatedCallbackClaim(created.attemptId, completionUri(), store.created!!.encryptedPkceVerifier)
        val callback = service.completeCallback(FederatedCallbackCommand("state", "code", false))
        assertNotNull(callback.completionProof)
        return created.attemptId
    }

    private fun service(): FederatedAuthenticationService {
        val tokenGenerator =
            FederatedTokenGenerator {
                if (it ==
                    64
                ) {
                    "pkce-verifier"
                } else {
                    "secret-${UUID.randomUUID()}"
                }
            }
        val mapper = JsonMapper.builder().findAndAddModules().build()
        val dependencies =
            FederatedAuthenticationDependencies(
                true,
                { FederatedLoginSecurity(ByteArray(32) { 1 }, tokenGenerator) },
                { FederatedAead(ByteArray(32) { 2 }) },
                { provider },
                mapper,
                FederatedRuntimeDependencies(
                    Clock.fixed(now, ZoneOffset.UTC),
                    LegalDocumentBundle("bundle-v1", "terms-v1", "privacy-v1", "zh-CN"),
                ),
            )
        return FederatedAuthenticationService(store, identities, StubRateLimiter(), sessions, dependencies)
    }

    private fun completionUri() = URI("http://127.0.0.1:50000/taskpilot/oauth/complete/abcdefghijklmnopqrstuvwxyzABCDEF")

    private inner class StubStore : FederatedLoginStore {
        var created: FederatedLoginAttempt? = null
        var callbackClaim: FederatedCallbackClaim? = null
        var status = FederatedLoginAttemptStatus.PENDING
        var encryptedIdentity: ByteArray? = null
        var encryptedResult: ByteArray? = null
        var continuationId: ContinuationId? = null
        var continuationDigest: String? = null
        var completeSucceeds = true
        var cancelSucceeds = true
        var findSucceeds = true
        var identityReleaseCount = 0
        var registrationReleaseCount = 0

        override fun createAttempt(attempt: FederatedLoginAttempt) {
            created = attempt
            status = attempt.status
        }

        override fun claimCallbackByState(
            oauthStateDigest: String,
            now: Instant,
        ): FederatedCallbackClaim? =
            callbackClaim.also {
                callbackClaim =
                    null
                ; status = FederatedLoginAttemptStatus.CALLBACK_PROCESSING
            }

        override fun finishCallback(
            attemptId: AttemptId,
            status: FederatedLoginAttemptStatus,
            now: Instant,
        ) = true.also {
            this.status =
                status
        }

        override fun completeCallback(
            attemptId: AttemptId,
            encryptedIdentityCandidate: ByteArray,
            completionProofDigest: String,
            now: Instant,
        ): Boolean {
            encryptedIdentity = encryptedIdentityCandidate
            status = FederatedLoginAttemptStatus.COMPLETION_PENDING
            return true
        }

        override fun findAttemptForPoll(
            attemptId: AttemptId,
            pollSecretDigest: String,
            now: Instant,
        ) = if (findSucceeds) {
            FederatedAttemptView(attemptId, status, encryptedIdentity, encryptedResult, now.plusSeconds(300))
        } else {
            null
        }

        override fun claimIdentity(
            attemptId: AttemptId,
            pollSecretDigest: String,
            completionProofDigest: String,
            now: Instant,
        ): FederatedAttemptView? {
            if (status != FederatedLoginAttemptStatus.COMPLETION_PENDING) return null
            status = FederatedLoginAttemptStatus.IDENTITY_PROCESSING
            return FederatedAttemptView(attemptId, status, encryptedIdentity, null, now.plusSeconds(300))
        }

        override fun requireRegistration(
            attemptId: AttemptId,
            continuationId: ContinuationId,
            continuationSecretDigest: String,
            encryptedResult: ByteArray,
            now: Instant,
        ): Boolean {
            this.continuationId = continuationId
            continuationDigest = continuationSecretDigest
            this.encryptedResult = encryptedResult
            status = FederatedLoginAttemptStatus.REGISTRATION_PENDING
            return true
        }

        override fun claimRegistration(
            continuationId: ContinuationId,
            continuationSecretDigest: String,
            now: Instant,
        ): FederatedRegistrationClaim? {
            if (this.continuationId != continuationId ||
                this.continuationDigest != continuationSecretDigest
            ) {
                return null
            }
            status = FederatedLoginAttemptStatus.REGISTRATION_PROCESSING
            return FederatedRegistrationClaim(created!!.attemptId, encryptedIdentity!!)
        }

        override fun releaseIdentity(
            attemptId: AttemptId,
            now: Instant,
        ): Boolean {
            identityReleaseCount += 1
            status = FederatedLoginAttemptStatus.COMPLETION_PENDING
            return true
        }

        override fun releaseRegistration(
            attemptId: AttemptId,
            now: Instant,
        ): Boolean {
            registrationReleaseCount += 1
            status = FederatedLoginAttemptStatus.REGISTRATION_PENDING
            return true
        }

        override fun complete(
            attemptId: AttemptId,
            encryptedResult: ByteArray,
            now: Instant,
        ): Boolean {
            if (completeSucceeds) {
                this.encryptedResult = encryptedResult
                status = FederatedLoginAttemptStatus.COMPLETED
            }
            return completeSucceeds
        }

        override fun cancel(
            attemptId: AttemptId,
            pollSecretDigest: String,
            now: Instant,
        ) = cancelSucceeds.also { succeeded ->
            if (succeeded) status = FederatedLoginAttemptStatus.CANCELLED
        }
    }

    private class StubIdentities : FederatedIdentityStore {
        var user: FederatedUserProfile? = null
        var registration: NewFederatedUser? = null
        var duplicateOnRegister = false

        override fun findUser(key: ExternalIdentityKey) = user

        override fun register(registration: NewFederatedUser): UserId {
            if (duplicateOnRegister) throw ExternalIdentityAlreadyExistsException()
            this.registration = registration
            return registration.user.userId
        }
    }

    private class StubSessions : SessionUseCases {
        var logoutCount = 0

        override fun issue(user: SessionUser) =
            IssuedSession(
                SessionId(UUID.randomUUID()),
                SessionFamilyId(UUID.randomUUID()),
                "access",
                Instant.now().plusSeconds(900),
                "refresh",
                Instant.now().plusSeconds(3600),
                CurrentUserView(user.userId, user.displayName, user.avatarUrl),
            )

        override fun refresh(refreshToken: String) = RefreshSessionResult.AuthenticationRequired

        override fun currentUser(accessToken: String) = CurrentUserResult.AuthenticationRequired

        override fun logout(accessToken: String) {
            logoutCount += 1
        }
    }

    private class StubRateLimiter : FederatedAttemptRateLimiter {
        override fun acquire(
            sourceNetwork: String,
            installationId: String,
            now: Instant,
            window: Duration,
            maximumAttempts: Int,
        ): Long? = null
    }

    private class StubProvider : FederatedIdentityProvider {
        var failure: FederatedProviderFailure? = null
        var providerName = "github"

        override fun authorizationUri(
            state: String,
            pkceChallenge: String,
        ) = URI("https://github.com/login/oauth/authorize?state=$state")

        override fun resolveIdentity(
            authorizationCode: String,
            pkceVerifier: String,
        ): ProviderIdentity {
            failure?.let { throw it }
            return ProviderIdentity(
                providerName,
                URI("https://github.com"),
                "42",
                "Ada",
                URI("https://example.com/avatar"),
            )
        }
    }
}
