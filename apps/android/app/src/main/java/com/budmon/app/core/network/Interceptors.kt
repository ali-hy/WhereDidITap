// F-251: the headers every API request carries, and the idempotency key of a create.
package com.budmon.app.core.network

import okhttp3.Interceptor
import okhttp3.Response
import java.util.UUID
import kotlin.random.Random

/** Adds `X-Budmon-Client: android/<versionCode>`. */
class ClientHeaderInterceptor(private val versionCode: Int) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response = chain.proceed(
        chain
            .request()
            .newBuilder()
            .header("X-Budmon-Client", "android/$versionCode")
            .build(),
    )
}

/** Adds a W3C `traceparent` with a new random trace and span id, sampled. */
class TraceparentInterceptor(private val random: Random = Random.Default) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val traceparent = "00-${nonZeroHex(16)}-${nonZeroHex(8)}-01"
        return chain.proceed(
            chain
                .request()
                .newBuilder()
                .header("traceparent", traceparent)
                .build(),
        )
    }

    /** All-zero ids are invalid in W3C trace context. */
    private fun nonZeroHex(bytes: Int): String {
        while (true) {
            val value = random.nextBytes(bytes)
            if (value.any { it.toInt() != 0 }) return value.joinToString("") { "%02x".format(it) }
        }
    }
}

/** The request tag that carries a create's idempotency key. */
data class IdempotencyKey(val value: UUID)

/** Sets `Idempotency-Key` (lower-case) from the request's [IdempotencyKey] tag; nothing without one. */
class IdempotencyKeyInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val key = request.tag(IdempotencyKey::class.java) ?: return chain.proceed(request)
        return chain.proceed(request.newBuilder().header("Idempotency-Key", key.value.toString().lowercase()).build())
    }
}
