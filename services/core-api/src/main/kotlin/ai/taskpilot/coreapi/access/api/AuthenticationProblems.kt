package ai.taskpilot.coreapi.access.api

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.ConstraintViolationException
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import java.net.URI

class AuthenticationProblemException(
    val status: HttpStatus,
    val code: String,
    val path: String? = null,
    val retryAfterSeconds: Long? = null,
    cause: Throwable? = null,
) : RuntimeException(code, cause)

@RestControllerAdvice
class AuthenticationProblemHandler {
    @ExceptionHandler(AuthenticationProblemException::class)
    fun authenticationProblem(
        failure: AuthenticationProblemException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> =
        problem(
            failure.status,
            failure.code,
            request,
            failure.path,
            failure.retryAfterSeconds,
        )

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun invalidArgument(
        failure: MethodArgumentNotValidException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> =
        problem(
            HttpStatus.BAD_REQUEST,
            "VALIDATION_FAILED",
            request,
            failure.bindingResult.fieldErrors
                .firstOrNull()
                ?.field,
        )

    @ExceptionHandler(
        MethodArgumentTypeMismatchException::class,
        MissingServletRequestParameterException::class,
    )
    fun invalidRequestParameter(
        failure: Exception,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> =
        problem(
            HttpStatus.BAD_REQUEST,
            "VALIDATION_FAILED",
            request,
            when (failure) {
                is MethodArgumentTypeMismatchException -> failure.name
                is MissingServletRequestParameterException -> failure.parameterName
                else -> null
            },
        )

    @ExceptionHandler(HttpMessageNotReadableException::class, ConstraintViolationException::class)
    fun malformedRequest(
        failure: Exception,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", request)
    }

    @ExceptionHandler(DataAccessException::class)
    fun temporarilyUnavailable(
        failure: DataAccessException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.SERVICE_UNAVAILABLE, "TEMPORARILY_UNAVAILABLE", request)
    }

    @ExceptionHandler(IllegalArgumentException::class)
    fun invalidInput(
        failure: IllegalArgumentException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", request)
    }

    private fun problem(
        status: HttpStatus,
        code: String,
        request: HttpServletRequest,
        fieldPath: String? = null,
        retryAfterSeconds: Long? = null,
    ): ResponseEntity<ProblemDetail> {
        val detail = ProblemDetail.forStatus(status)
        detail.type = URI.create("https://taskpilot.ai/problems/${code.lowercase().replace('_', '-')}")
        detail.title = status.reasonPhrase
        detail.detail = safeDetail(code)
        detail.instance = URI.create(request.requestURI)
        detail.setProperty("code", code)
        detail.setProperty("correlationId", request.getAttribute(CORRELATION_ID_ATTRIBUTE).toString())
        fieldPath?.let { detail.setProperty("path", it) }
        retryAfterSeconds?.let { detail.setProperty("retryAfterSeconds", it) }
        return ResponseEntity.status(status).body(detail)
    }

    private fun safeDetail(code: String): String =
        when (code) {
            "AUTHENTICATION_REQUIRED" -> "Authentication is required."
            "AUTHENTICATION_RATE_LIMITED" -> "Try again later."
            "AUTHENTICATION_TEMPORARILY_UNAVAILABLE" -> "Authentication is temporarily unavailable."
            "TEMPORARILY_UNAVAILABLE" -> "The service is temporarily unavailable."
            else -> "The request is invalid."
        }
}

const val CORRELATION_ID_ATTRIBUTE = "taskpilot.correlationId"
