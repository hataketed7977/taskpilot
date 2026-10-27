package ai.taskpilot.coreapi.project.api

import ai.taskpilot.coreapi.project.BoardDeleteRestricted
import ai.taskpilot.coreapi.project.BoardNameConfirmationMismatch
import ai.taskpilot.coreapi.project.BoardNotEmptyConflict
import ai.taskpilot.coreapi.project.BoardVersionConflict
import ai.taskpilot.coreapi.project.ColumnNotEmptyConflict
import ai.taskpilot.coreapi.project.LastColumnConflict
import ai.taskpilot.coreapi.project.PlacementConflict
import ai.taskpilot.coreapi.project.ProjectDeleteRestricted
import ai.taskpilot.coreapi.project.ProjectIdempotencyConflict
import ai.taskpilot.coreapi.project.ProjectNameConfirmationMismatch
import ai.taskpilot.coreapi.project.ProjectNotFound
import ai.taskpilot.coreapi.project.ProjectResourceVersionConflict
import ai.taskpilot.coreapi.project.ProjectValidationFailed
import ai.taskpilot.coreapi.project.ProjectVersionConflict
import ai.taskpilot.coreapi.project.ProjectWorkIdempotencyConflict
import ai.taskpilot.coreapi.project.ProjectWorkNotFound
import ai.taskpilot.coreapi.project.ProjectWorkValidationFailed
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

@RestControllerAdvice(assignableTypes = [ProjectController::class, ProjectWorkController::class])
@Suppress("TooManyFunctions") // Explicit exception mappings keep the HTTP error contract auditable.
class ProjectProblemHandler {
    @ExceptionHandler(ProjectValidationFailed::class)
    fun validation(
        failure: ProjectValidationFailed,
        request: HttpServletRequest,
    ) = problem(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", request, failure.path)

    @ExceptionHandler(ProjectWorkValidationFailed::class)
    fun workValidation(
        failure: ProjectWorkValidationFailed,
        request: HttpServletRequest,
    ) = problem(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", request, failure.path)

    @ExceptionHandler(ProjectWorkNotFound::class)
    fun projectWorkNotFound(
        failure: ProjectWorkNotFound,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND", request)
    }

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

    @ExceptionHandler(BoardVersionConflict::class)
    fun boardVersionConflict(
        failure: BoardVersionConflict,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "BOARD_VERSION_CONFLICT", request)
    }

    @ExceptionHandler(BoardNameConfirmationMismatch::class)
    fun boardNameConfirmationMismatch(
        failure: BoardNameConfirmationMismatch,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "BOARD_NAME_CONFIRMATION_MISMATCH", request)
    }

    @ExceptionHandler(BoardNotEmptyConflict::class)
    fun boardNotEmpty(
        failure: BoardNotEmptyConflict,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "BOARD_NOT_EMPTY", request)
    }

    @ExceptionHandler(BoardDeleteRestricted::class)
    fun boardDeleteRestricted(
        failure: BoardDeleteRestricted,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "BOARD_DELETE_RESTRICTED", request)
    }

    @ExceptionHandler(ProjectResourceVersionConflict::class)
    fun resourceVersionConflict(
        failure: ProjectResourceVersionConflict,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "RESOURCE_VERSION_CONFLICT", request)
    }

    @ExceptionHandler(ColumnNotEmptyConflict::class)
    fun columnNotEmpty(
        failure: ColumnNotEmptyConflict,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "COLUMN_NOT_EMPTY", request)
    }

    @ExceptionHandler(LastColumnConflict::class)
    fun lastColumn(
        failure: LastColumnConflict,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "LAST_COLUMN", request)
    }

    @ExceptionHandler(PlacementConflict::class)
    fun placementConflict(
        failure: PlacementConflict,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "PLACEMENT_CONFLICT", request)
    }

    @ExceptionHandler(ProjectWorkIdempotencyConflict::class)
    fun workIdempotencyConflict(
        failure: ProjectWorkIdempotencyConflict,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        failure.hashCode()
        return problem(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", request)
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
            "BOARD_VERSION_CONFLICT",
            "BOARD_NAME_CONFIRMATION_MISMATCH",
            "BOARD_NOT_EMPTY",
            "BOARD_DELETE_RESTRICTED",
            "RESOURCE_VERSION_CONFLICT",
            "COLUMN_NOT_EMPTY",
            "LAST_COLUMN",
            "PLACEMENT_CONFLICT",
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
