package ai.taskpilot.coreapi.access.persistence

import ai.taskpilot.coreapi.access.AccessAccountProvisioning
import ai.taskpilot.coreapi.access.FederatedAccountProvisioningRequest
import ai.taskpilot.coreapi.access.application.ExternalIdentityAlreadyExistsException
import ai.taskpilot.coreapi.access.application.FederatedIdentityStore
import ai.taskpilot.coreapi.access.model.ExternalIdentity
import ai.taskpilot.coreapi.access.model.ExternalIdentityKey
import ai.taskpilot.coreapi.access.model.FederatedUserProfile
import ai.taskpilot.coreapi.access.model.UserId
import ai.taskpilot.coreapi.access.model.UserStatus
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import java.sql.SQLException
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource

@Suppress("TooManyFunctions") // Narrow JDBC adapter helpers keep each provisioning insert auditable.
class JdbcFederatedIdentityStore(
    dataSource: DataSource,
) : FederatedIdentityStore,
    AccessAccountProvisioning {
    private val jdbc = JdbcTemplate(dataSource)

    override fun provisionAccount(request: FederatedAccountProvisioningRequest) {
        translateIdentityConflict {
            val timestamp = request.now.atOffset(ZoneOffset.UTC)
            insertUser(request, timestamp)
            insertIdentity(request, timestamp)
            insertTermsAcceptance(request, timestamp)
        }
    }

    private fun insertUser(
        account: FederatedAccountProvisioningRequest,
        timestamp: OffsetDateTime,
    ) {
        jdbc.update(
            """
            INSERT INTO access.users (id, display_name, avatar_url, status, created_at)
            VALUES (?, ?, ?, 'ACTIVE', ?)
            """.trimIndent(),
            account.userId,
            account.displayName,
            account.avatarUrl?.toASCIIString(),
            timestamp,
        )
    }

    private fun insertIdentity(
        account: FederatedAccountProvisioningRequest,
        timestamp: OffsetDateTime,
    ) {
        jdbc.update(
            """
            INSERT INTO access.external_identities (
                id, user_id, provider, authority, subject, linked_at, last_authenticated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            account.userId,
            account.provider,
            account.authority.toASCIIString(),
            account.subject,
            timestamp,
            timestamp,
        )
    }

    private fun insertTermsAcceptance(
        account: FederatedAccountProvisioningRequest,
        timestamp: OffsetDateTime,
    ) {
        jdbc.update(
            """
            INSERT INTO access.terms_acceptances (
                id, user_id, legal_bundle_version, terms_version, privacy_version, locale, accepted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            account.userId,
            account.legalBundleVersion,
            account.termsVersion,
            account.privacyVersion,
            account.legalLocale,
            timestamp,
        )
    }

    fun link(identity: ExternalIdentity) {
        translateIdentityConflict { insertIdentity(identity) }
    }

    override fun findUser(key: ExternalIdentityKey): FederatedUserProfile? =
        jdbc
            .query(
                """
                SELECT u.id AS user_id, u.display_name, u.avatar_url, u.status
                FROM access.external_identities i
                JOIN access.users u ON u.id = i.user_id
                WHERE i.provider = ? AND i.authority = ? AND i.subject = ?
                """.trimIndent(),
                { rows, _ ->
                    FederatedUserProfile(
                        UserId(rows.getObject("user_id", UUID::class.java)),
                        rows.getString("display_name"),
                        rows.getString("avatar_url")?.let(java.net.URI::create),
                        UserStatus.valueOf(rows.getString("status")),
                    )
                },
                key.provider,
                key.authority.toASCIIString(),
                key.subject,
            ).singleOrNull()

    fun findUserId(key: ExternalIdentityKey): UserId? = findUser(key)?.userId

    private fun insertIdentity(identity: ExternalIdentity) {
        jdbc.update(
            """
            INSERT INTO access.external_identities (
                id, user_id, provider, authority, subject, linked_at, last_authenticated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            identity.externalIdentityId.value,
            identity.userId.value,
            identity.key.provider,
            identity.key.authority.toASCIIString(),
            identity.key.subject,
            identity.linkedAt.atOffset(ZoneOffset.UTC),
            identity.lastAuthenticatedAt.atOffset(ZoneOffset.UTC),
        )
    }

    private fun <T> translateIdentityConflict(block: () -> T): T =
        try {
            block()
        } catch (failure: DataIntegrityViolationException) {
            if (failure.hasConstraint(EXTERNAL_IDENTITY_UNIQUE_CONSTRAINT)) {
                throw ExternalIdentityAlreadyExistsException()
            }
            throw failure
        }

    private fun Throwable.hasConstraint(name: String): Boolean =
        generateSequence<Throwable>(this) { it.cause }
            .filterIsInstance<SQLException>()
            .any { it.sqlState == UNIQUE_VIOLATION_SQL_STATE && it.message.orEmpty().contains(name) }

    private companion object {
        const val UNIQUE_VIOLATION_SQL_STATE = "23505"
        const val EXTERNAL_IDENTITY_UNIQUE_CONSTRAINT = "uq_external_identities__provider_authority_subject"
    }
}
