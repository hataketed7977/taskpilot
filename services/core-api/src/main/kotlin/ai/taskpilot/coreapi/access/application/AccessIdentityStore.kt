package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.NewAccessIdentity
import ai.taskpilot.coreapi.access.model.UserId

interface AccessIdentityStore {
    fun create(identity: NewAccessIdentity): UserId
}

class EmailIdentityAlreadyExistsException : RuntimeException("An account already exists for this email")
