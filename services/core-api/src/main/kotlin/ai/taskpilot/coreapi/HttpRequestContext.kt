package ai.taskpilot.coreapi

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes

internal fun currentAuthenticatedActor(): AuthenticatedActor =
    SecurityContextHolder.getContext().authentication?.principal as? AuthenticatedActor
        ?: throw AuthenticationProblemException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED")

internal fun currentHttpRequest(): HttpServletRequest =
    (RequestContextHolder.currentRequestAttributes() as ServletRequestAttributes).request
