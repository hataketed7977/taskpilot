package ai.taskpilot.coreapi.access.application

import ai.taskpilot.coreapi.access.model.SecretDigest
import java.nio.charset.StandardCharsets
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

interface SecretDigester {
    fun digest(
        namespace: String,
        secret: CharSequence,
    ): SecretDigest
}

class HmacSha256SecretDigester(
    pepper: ByteArray,
) : SecretDigester {
    private val key = pepper.copyOf()

    init {
        require(key.size >= MINIMUM_PEPPER_BYTES)
    }

    override fun digest(
        namespace: String,
        secret: CharSequence,
    ): SecretDigest {
        require(namespace.isNotBlank())
        val payload = "$namespace\u0000$secret".toByteArray(StandardCharsets.UTF_8)
        return SecretDigest.fromEncoded(newHmacSha256(key).doFinal(payload).base64Url())
    }

    private companion object {
        const val MINIMUM_PEPPER_BYTES = 32
    }
}

internal fun ByteArray.base64Url(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(this)

private fun newHmacSha256(key: ByteArray): Mac =
    Mac.getInstance("HmacSHA256").apply {
        init(SecretKeySpec(key, "HmacSHA256"))
    }
