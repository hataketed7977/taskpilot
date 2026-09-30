package ai.taskpilot.coreapi.access.persistence

import ai.taskpilot.coreapi.access.application.ACCESS_TOKEN_DIGEST_NAMESPACE
import ai.taskpilot.coreapi.access.application.CurrentUserResult
import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.IssuedSession
import ai.taskpilot.coreapi.access.application.REFRESH_TOKEN_DIGEST_NAMESPACE
import ai.taskpilot.coreapi.access.application.RefreshSessionCommand
import ai.taskpilot.coreapi.access.application.RefreshSessionResult
import ai.taskpilot.coreapi.access.application.SecretDigester
import ai.taskpilot.coreapi.access.application.SessionFamilyId
import ai.taskpilot.coreapi.access.application.SessionId
import ai.taskpilot.coreapi.access.application.SessionPolicy
import ai.taskpilot.coreapi.access.application.SessionRecoveryCipher
import ai.taskpilot.coreapi.access.application.SessionTokenGenerator
import ai.taskpilot.coreapi.access.application.SessionUseCases
import ai.taskpilot.coreapi.access.model.UserId
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.UUID
import javax.sql.DataSource

// This transactional adapter intentionally keeps session lifecycle operations together.
@Suppress("LongParameterList", "TooManyFunctions")
class JdbcSessionUseCases(
    dataSource: DataSource,
    private val secretDigester: SecretDigester,
    private val tokenGenerator: SessionTokenGenerator,
    private val recoveryCipher: SessionRecoveryCipher,
    private val sessionPolicy: SessionPolicy,
    private val recoveryWindow: Duration,
    private val clock: Clock,
) : SessionUseCases {
    private val jdbc = JdbcTemplate(dataSource)
    private val transaction = TransactionTemplate(DataSourceTransactionManager(dataSource))

    init {
        require(recoveryWindow.isPositive)
    }

    override fun refresh(command: RefreshSessionCommand): RefreshSessionResult =
        transaction.requiredResult {
            val now = clock.instant().truncatedTo(ChronoUnit.MILLIS)
            val previousDigest = digestRefresh(command.refreshToken)
            val active = lockActiveByRefreshDigest(previousDigest)
            if (active != null) {
                if (!active.isRefreshableAt(now)) {
                    revokeFamily(active.familyId, now)
                    return@requiredResult RefreshSessionResult.AuthenticationRequired
                }
                return@requiredResult rotate(active, previousDigest, command.refreshRequestId, now)
            }
            recoverOrRevoke(previousDigest, command.refreshRequestId, now)
        }

    override fun currentUser(accessToken: String): CurrentUserResult {
        val digest = secretDigester.digest(ACCESS_TOKEN_DIGEST_NAMESPACE, accessToken).encoded
        val now = clock.instant().truncatedTo(ChronoUnit.MILLIS)
        val user =
            jdbc
                .query(
                    """
                    SELECT u.user_id, u.display_name, e.normalized_email
                    FROM user_sessions s
                    JOIN app_users u ON u.user_id = s.user_id
                    JOIN email_identities e ON e.user_id = u.user_id
                    WHERE s.access_token_digest = ? AND s.status = 'ACTIVE'
                      AND s.access_expires_at > ? AND u.status = 'ACTIVE'
                    """.trimIndent(),
                    { rows, _ ->
                        CurrentUserView(
                            UserId(rows.getObject("user_id", UUID::class.java)),
                            rows.getString("display_name"),
                            rows.getString("normalized_email"),
                        )
                    },
                    digest,
                    now.utc(),
                ).singleOrNull()
        return user?.let(CurrentUserResult::Authenticated) ?: CurrentUserResult.AuthenticationRequired
    }

    override fun logout(accessToken: String) {
        transaction.requiredResult {
            val now = clock.instant().truncatedTo(ChronoUnit.MILLIS)
            val digest = secretDigester.digest(ACCESS_TOKEN_DIGEST_NAMESPACE, accessToken).encoded
            val familyId =
                jdbc
                    .query(
                        "SELECT family_id FROM user_sessions WHERE access_token_digest = ? FOR UPDATE",
                        { rows, _ -> SessionFamilyId(rows.getObject("family_id", UUID::class.java)) },
                        digest,
                    ).singleOrNull()
            familyId?.let { revokeFamily(it, now) }
            Unit
        }
    }

    private fun rotate(
        active: StoredSession,
        previousDigest: String,
        requestId: UUID,
        now: Instant,
    ): RefreshSessionResult.Refreshed {
        val accessToken = tokenGenerator.generate()
        val refreshToken = tokenGenerator.generate()
        val accessExpiry = now.plus(sessionPolicy.accessTtl)
        val refreshExpiry = minOf(now.plus(sessionPolicy.refreshInactivityTtl), active.absoluteExpiresAt)
        val session =
            IssuedSession(
                active.sessionId,
                active.familyId,
                accessToken,
                accessExpiry,
                refreshToken,
                refreshExpiry,
                active.currentUser,
            )
        check(
            jdbc.update(
                """
                UPDATE user_sessions
                SET access_token_digest = ?, access_expires_at = ?, refresh_token_digest = ?,
                    refresh_expires_at = ?, generation = generation + 1, last_refreshed_at = ?
                WHERE session_id = ? AND status = 'ACTIVE' AND refresh_token_digest = ?
                """.trimIndent(),
                secretDigester.digest(ACCESS_TOKEN_DIGEST_NAMESPACE, accessToken).encoded,
                accessExpiry.utc(),
                digestRefresh(refreshToken),
                refreshExpiry.utc(),
                now.utc(),
                active.sessionId.value,
                previousDigest,
            ) == 1,
        ) { "Locked session could not be rotated" }
        jdbc.update(
            """
            INSERT INTO refresh_recoveries (
                refresh_request_id, session_id, previous_refresh_digest,
                encrypted_result, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            requestId,
            active.sessionId.value,
            previousDigest,
            recoveryCipher.encrypt(session),
            now.utc(),
            now.plus(recoveryWindow).utc(),
        )
        return RefreshSessionResult.Refreshed(session)
    }

    // Early exits make the fail-closed recovery cases explicit.
    @Suppress("ReturnCount")
    private fun recoverOrRevoke(
        previousDigest: String,
        requestId: UUID,
        now: Instant,
    ): RefreshSessionResult {
        val recovery =
            lockRecovery(previousDigest)
                ?: return RefreshSessionResult.AuthenticationRequired
        if (recovery.requestId == requestId && recovery.expiresAt.isAfter(now) && recovery.sessionActive) {
            return RefreshSessionResult.Refreshed(recoveryCipher.decrypt(recovery.encryptedResult))
        }
        revokeFamily(recovery.familyId, now)
        return RefreshSessionResult.AuthenticationRequired
    }

    private fun lockActiveByRefreshDigest(digest: String): StoredSession? =
        jdbc
            .query(
                """
                SELECT s.session_id, s.family_id, s.user_id, s.refresh_expires_at,
                       s.absolute_expires_at, u.display_name, e.normalized_email
                FROM user_sessions s
                JOIN app_users u ON u.user_id = s.user_id
                JOIN email_identities e ON e.user_id = u.user_id
                WHERE s.refresh_token_digest = ? AND s.status = 'ACTIVE'
                FOR UPDATE OF s
                """.trimIndent(),
                { rows, _ ->
                    StoredSession(
                        SessionId(rows.getObject("session_id", UUID::class.java)),
                        SessionFamilyId(rows.getObject("family_id", UUID::class.java)),
                        rows.getObject("refresh_expires_at", OffsetDateTime::class.java).toInstant(),
                        rows.getObject("absolute_expires_at", OffsetDateTime::class.java).toInstant(),
                        CurrentUserView(
                            UserId(rows.getObject("user_id", UUID::class.java)),
                            rows.getString("display_name"),
                            rows.getString("normalized_email"),
                        ),
                    )
                },
                digest,
            ).singleOrNull()

    private fun lockRecovery(previousDigest: String): StoredRecovery? =
        jdbc
            .query(
                """
                SELECT r.refresh_request_id, r.encrypted_result, r.expires_at,
                       s.family_id, s.status
                FROM refresh_recoveries r
                JOIN user_sessions s ON s.session_id = r.session_id
                WHERE r.previous_refresh_digest = ?
                ORDER BY r.created_at DESC
                LIMIT 1
                FOR UPDATE OF s, r
                """.trimIndent(),
                { rows, _ ->
                    StoredRecovery(
                        rows.getObject("refresh_request_id", UUID::class.java),
                        rows.getBytes("encrypted_result"),
                        rows.getObject("expires_at", OffsetDateTime::class.java).toInstant(),
                        SessionFamilyId(rows.getObject("family_id", UUID::class.java)),
                        rows.getString("status") == "ACTIVE",
                    )
                },
                previousDigest,
            ).singleOrNull()

    private fun revokeFamily(
        familyId: SessionFamilyId,
        now: Instant,
    ) {
        jdbc.update(
            """
            UPDATE user_sessions
            SET status = 'REVOKED', revoked_at = ?
            WHERE family_id = ? AND status = 'ACTIVE'
            """.trimIndent(),
            now.utc(),
            familyId.value,
        )
    }

    @Suppress("MaxLineLength") // ktlint requires this single-expression helper on one line.
    private fun digestRefresh(token: String): String = secretDigester.digest(REFRESH_TOKEN_DIGEST_NAMESPACE, token).encoded

    private data class StoredSession(
        val sessionId: SessionId,
        val familyId: SessionFamilyId,
        val refreshExpiresAt: Instant,
        val absoluteExpiresAt: Instant,
        val currentUser: CurrentUserView,
    ) {
        fun isRefreshableAt(now: Instant): Boolean = refreshExpiresAt.isAfter(now) && absoluteExpiresAt.isAfter(now)
    }

    private data class StoredRecovery(
        val requestId: UUID,
        val encryptedResult: ByteArray,
        val expiresAt: Instant,
        val familyId: SessionFamilyId,
        val sessionActive: Boolean,
    )

    private fun Instant.utc(): OffsetDateTime = atOffset(ZoneOffset.UTC)

    private fun <T> TransactionTemplate.requiredResult(action: () -> T): T =
        requireNotNull(execute { action() }) { "Session transaction returned no result" }
}
