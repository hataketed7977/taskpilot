package ai.taskpilot.coreapi.project.api

import ai.taskpilot.coreapi.access.api.CORRELATION_ID_ATTRIBUTE
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import java.net.URI

class ProjectProblemException(
    val status: HttpStatus,
    val code: String,
    cause: Throwable? = null,
) : RuntimeException(code, cause)

@RestControllerAdvice(assignableTypes = [ProjectController::class])
class ProjectProblemHandler {
    @ExceptionHandler(ProjectProblemException::class)
    fun handle(
        failure: ProjectProblemException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemDetail> {
        val detail = ProblemDetail.forStatus(failure.status)
        detail.type = URI.create("https://taskpilot.ai/problems/${failure.code.lowercase().replace('_', '-')}")
        detail.title = failure.status.reasonPhrase
        detail.detail =
            when (failure.code) {
                "WORKSPACE_NOT_FOUND" -> "The Workspace is not available."
                "PROJECTS_TEMPORARILY_UNAVAILABLE" -> "Projects are temporarily unavailable."
                else -> "The request is invalid."
            }
        detail.instance = URI.create(request.requestURI)
        detail.setProperty("code", failure.code)
        detail.setProperty("correlationId", request.getAttribute(CORRELATION_ID_ATTRIBUTE).toString())
        return ResponseEntity.status(failure.status).body(detail)
    }
}
