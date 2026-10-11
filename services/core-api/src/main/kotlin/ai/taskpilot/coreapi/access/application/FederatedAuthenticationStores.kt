package ai.taskpilot.coreapi.access.application

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
import java.time.Duration
import java.time.Instant

interface FederatedLoginStore {
    fun createAttempt(attempt: FederatedLoginAttempt)

    fun claimCallbackByState(
        oauthStateDigest: String,
        now: Instant,
    ): FederatedCallbackClaim?

    fun finishCallback(
        attemptId: AttemptId,
        status: FederatedLoginAttemptStatus,
        now: Instant,
    ): Boolean

    fun completeCallback(
        attemptId: AttemptId,
        encryptedIdentityCandidate: ByteArray,
        completionProofDigest: String,
        now: Instant,
    ): Boolean

    fun findAttemptForPoll(
        attemptId: AttemptId,
        pollSecretDigest: String,
        now: Instant,
    ): FederatedAttemptView?

    fun claimIdentity(
        attemptId: AttemptId,
        pollSecretDigest: String,
        completionProofDigest: String,
        now: Instant,
    ): FederatedAttemptView?

    fun requireRegistration(
        attemptId: AttemptId,
        continuationId: ContinuationId,
        continuationSecretDigest: String,
        encryptedResult: ByteArray,
        now: Instant,
    ): Boolean

    fun claimRegistration(
        continuationId: ContinuationId,
        continuationSecretDigest: String,
        now: Instant,
    ): FederatedRegistrationClaim?

    fun releaseIdentity(
        attemptId: AttemptId,
        now: Instant,
    ): Boolean

    fun releaseRegistration(
        attemptId: AttemptId,
        now: Instant,
    ): Boolean

    fun complete(
        attemptId: AttemptId,
        encryptedResult: ByteArray,
        now: Instant,
    ): Boolean

    fun cancel(
        attemptId: AttemptId,
        pollSecretDigest: String,
        now: Instant,
    ): Boolean
}

class ExternalIdentityAlreadyExistsException : RuntimeException("External identity already exists")

interface FederatedIdentityStore {
    fun findUser(key: ExternalIdentityKey): FederatedUserProfile?

    fun register(registration: NewFederatedUser): UserId
}

interface FederatedAttemptRateLimiter {
    fun acquire(
        sourceNetwork: String,
        installationId: String,
        now: Instant,
        window: Duration,
        maximumAttempts: Int,
    ): Long?
}
