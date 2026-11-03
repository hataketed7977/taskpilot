package ai.taskpilot.coreapi

import org.springframework.http.HttpStatus

class AuthenticationProblemException(
    val status: HttpStatus,
    val code: String,
    val path: String? = null,
    val retryAfterSeconds: Long? = null,
    cause: Throwable? = null,
) : RuntimeException(code, cause)
