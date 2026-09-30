package ai.taskpilot.coreapi.access.persistence

import ai.taskpilot.coreapi.access.application.AccessIdentityStore
import ai.taskpilot.coreapi.access.application.EmailIdentityAlreadyExistsException
import ai.taskpilot.coreapi.access.model.NewAccessIdentity
import ai.taskpilot.coreapi.access.model.UserId
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.sql.SQLException
import java.time.ZoneOffset
import javax.sql.DataSource

class JdbcAccessIdentityStore(
    dataSource: DataSource,
) : AccessIdentityStore {
    private val jdbc = JdbcTemplate(dataSource)
    private val transaction = TransactionTemplate(DataSourceTransactionManager(dataSource))

    override fun create(identity: NewAccessIdentity): UserId =
        try {
            requireNotNull(
                transaction.execute {
                    insertUser(identity)
                    insertEmailIdentity(identity)
                    insertPasswordCredential(identity)
                    insertTermsAcceptance(identity)
                    identity.user.userId
                },
            ) { "Access identity transaction returned no result" }
        } catch (failure: DataIntegrityViolationException) {
            if (failure.constraintName() == NORMALIZED_EMAIL_UNIQUE_CONSTRAINT) {
                throw EmailIdentityAlreadyExistsException()
            }
            throw failure
        }

    private fun insertUser(identity: NewAccessIdentity) {
        val user = identity.user
        jdbc.update(
            """
            INSERT INTO app_users (user_id, display_name, status, created_at)
            VALUES (?, ?, ?, ?)
            """.trimIndent(),
            user.userId.value,
            user.displayName,
            user.status.name,
            user.createdAt.atOffset(ZoneOffset.UTC),
        )
    }

    private fun insertEmailIdentity(identity: NewAccessIdentity) {
        val emailIdentity = identity.emailIdentity
        jdbc.update(
            """
            INSERT INTO email_identities (
                email_identity_id, user_id, normalized_email, display_email, verified_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            emailIdentity.emailIdentityId.value,
            emailIdentity.userId.value,
            emailIdentity.email.normalized,
            emailIdentity.email.display,
            emailIdentity.verifiedAt.atOffset(ZoneOffset.UTC),
            emailIdentity.createdAt.atOffset(ZoneOffset.UTC),
        )
    }

    private fun insertPasswordCredential(identity: NewAccessIdentity) {
        val credential = identity.passwordCredential
        jdbc.update(
            """
            INSERT INTO password_credentials (user_id, argon2id_digest, changed_at)
            VALUES (?, ?, ?)
            """.trimIndent(),
            credential.userId.value,
            credential.digest.encoded,
            credential.changedAt.atOffset(ZoneOffset.UTC),
        )
    }

    private fun insertTermsAcceptance(identity: NewAccessIdentity) {
        val acceptance = identity.termsAcceptance
        jdbc.update(
            """
            INSERT INTO terms_acceptances (user_id, terms_version, accepted_at)
            VALUES (?, ?, ?)
            """.trimIndent(),
            acceptance.userId.value,
            acceptance.termsVersion,
            acceptance.acceptedAt.atOffset(ZoneOffset.UTC),
        )
    }

    private fun Throwable.constraintName(): String? =
        generateSequence<Throwable>(this) { it.cause }
            .filterIsInstance<SQLException>()
            .filter { it.sqlState == UNIQUE_VIOLATION_SQL_STATE }
            .mapNotNull { failure ->
                listOf(NORMALIZED_EMAIL_UNIQUE_CONSTRAINT)
                    .firstOrNull { constraint -> failure.message.orEmpty().contains(constraint) }
            }.firstOrNull()

    private companion object {
        const val UNIQUE_VIOLATION_SQL_STATE = "23505"
        const val NORMALIZED_EMAIL_UNIQUE_CONSTRAINT = "email_identities_normalized_email_unique"
    }
}
