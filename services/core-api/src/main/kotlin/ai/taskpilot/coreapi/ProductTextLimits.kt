package ai.taskpilot.coreapi

import java.text.Normalizer

object ProductTextLimits {
    const val USER_DISPLAY_NAME = 80
    const val PROJECT_NAME = 100
    const val PROJECT_DESCRIPTION = 1_000
    const val BOARD_NAME = 80
    const val BOARD_DESCRIPTION = 1_000
    const val COLUMN_NAME = 50
    const val WORK_ITEM_TITLE = 160
    const val WORK_ITEM_DESCRIPTION = 5_000
}

fun normalizeRequiredText(
    value: String,
    maximumCodePoints: Int,
    invalid: () -> RuntimeException,
): String =
    normalizeText(value).also {
        if (it.codePointCount(0, it.length) !in 1..maximumCodePoints) throw invalid()
    }

fun normalizeOptionalText(
    value: String?,
    maximumCodePoints: Int,
    invalid: () -> RuntimeException,
): String =
    normalizeText(value.orEmpty()).also {
        if (it.codePointCount(0, it.length) > maximumCodePoints) throw invalid()
    }

private fun normalizeText(value: String): String = Normalizer.normalize(value.trim(), Normalizer.Form.NFC)
