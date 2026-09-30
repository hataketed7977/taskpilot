package ai.taskpilot.coreapi.access.model

class EmailAddress internal constructor(
    val normalized: String,
    val display: String,
) {
    override fun toString(): String = "EmailAddress([REDACTED])"
}

class InvalidEmailAddressException : IllegalArgumentException("Email address is invalid")
