package ai.taskpilot.coreapi.project.api

import ai.taskpilot.coreapi.project.ProjectDeleteRestricted
import ai.taskpilot.coreapi.project.ProjectIdempotencyConflict
import ai.taskpilot.coreapi.project.ProjectNameConfirmationMismatch
import ai.taskpilot.coreapi.project.ProjectNotFound
import ai.taskpilot.coreapi.project.ProjectValidationFailed
import ai.taskpilot.coreapi.project.ProjectVersionConflict
import ai.taskpilot.coreapi.project.WorkspaceNotFound
import jakarta.servlet.http.HttpServletRequest
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import java.net.URI

@RestControllerAdvice(assignableTypes = [ProjectController::class])
class ProjectProblemHandler {
    @ExceptionHandler(ProjectValidationFailed::class)
    fun validation(
        failure: ProjectValidationFailed,
        request: HttpServletRequest,
    ) = problem(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", request, failure.path)

    @ExceptionHandler(WorkspaceNotFound::class, ProjectNotFound::class)
    fun projectNotFound(
        failure: RuntimeException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND", request)
    }

    @ExceptionHandler(ProjectVersionConflict::class)
    fun versionConflict(
        failure: ProjectVersionConflict,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "PROJECT_VERSION_CONFLICT", request)
    }

    @ExceptionHandler(ProjectNameConfirmationMismatch::class)
    fun nameConfirmationMismatch(
        failure: ProjectNameConfirmationMismatch,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "PROJECT_NAME_CONFIRMATION_MISMATCH", request)
    }

    @ExceptionHandler(ProjectDeleteRestricted::class)
    fun deleteRestricted(
        failure: ProjectDeleteRestricted,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "PROJECT_DELETE_RESTRICTED", request)
    }

    @ExceptionHandler(ProjectIdempotencyConflict::class)
    fun idempotencyConflict(
        failure: ProjectIdempotencyConflict,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", request)
    }

    @ExceptionHandler(DataAccessException::class)
    fun temporarilyUnavailable(
        failure: DataAccessException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.SERVICE_UNAVAILABLE, "TEMPORARILY_UNAVAILABLE", request)
    }

    @ExceptionHandler(
        HttpMessageNotReadableException::class,
        MethodArgumentTypeMismatchException::class,
        MissingServletRequestParameterException::class,
    )
    fun malformedRequest(
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

    private fun problem(
        status: HttpStatus,
        code: String,
        request: HttpServletRequest,
        path: String? = null,
    ): ResponseEntity<ProblemDetail> {
        val detail = ProblemDetail.forStatus(status)
        detail.type = URI.create("https://taskpilot.ai/problems/${code.lowercase().replace('_', '-')}")
        detail.title = status.reasonPhrase
        detail.detail = safeDetail(code)
        detail.instance = URI.create(request.requestURI)
        detail.setProperty("code", code)
        detail.setProperty("correlationId", request.getAttribute(CORRELATION_ID_ATTRIBUTE)?.toString().orEmpty())
        path?.let { detail.setProperty("path", it) }
        return ResponseEntity.status(status).body(detail)
    }

    private fun safeDetail(code: String): String =
        when (code) {
            "TEMPORARILY_UNAVAILABLE" -> "The service is temporarily unavailable."

            "PROJECT_NOT_FOUND" -> "The requested resource was not found."

            "PROJECT_VERSION_CONFLICT",
            "IDEMPOTENCY_CONFLICT",
            "PROJECT_NAME_CONFIRMATION_MISMATCH",
            "PROJECT_DELETE_RESTRICTED",
            -> "The request conflicts with the current state."

            else -> "The request is invalid."
        }

    private companion object {
        const val CORRELATION_ID_ATTRIBUTE = "taskpilot.correlationId"
    }
}
