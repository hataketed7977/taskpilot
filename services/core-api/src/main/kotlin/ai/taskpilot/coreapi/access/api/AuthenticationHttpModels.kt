package ai.taskpilot.coreapi.access.api

import ai.taskpilot.contract.generated.model.CurrentUserResponse
import ai.taskpilot.contract.generated.model.SessionResponse
import ai.taskpilot.coreapi.access.application.CurrentUserView
import ai.taskpilot.coreapi.access.application.IssuedSession
import java.time.ZoneOffset

internal fun CurrentUserView.toWireResponse() =
    CurrentUserResponse(
        userId = userId.value,
        displayName = displayName,
        avatarUrl = avatarUrl,
    )

internal fun IssuedSession.toWireResponse() =
    SessionResponse(
        accessToken = accessToken,
        accessTokenExpiresAt = accessTokenExpiresAt.atOffset(ZoneOffset.UTC),
        refreshToken = refreshToken,
        refreshTokenExpiresAt = refreshTokenExpiresAt.atOffset(ZoneOffset.UTC),
        currentUser = currentUser.toWireResponse(),
    )
