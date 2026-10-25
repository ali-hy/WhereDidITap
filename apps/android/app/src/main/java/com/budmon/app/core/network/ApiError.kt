// F-252: any API failure as one of five kinds.
package com.budmon.app.core.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject

sealed interface ApiError {
    /** The contract's error envelope (`defined: true`). */
    data class Defined(val key: String, val status: Int, val data: JsonObject?) : ApiError

    /** A gateway answer without an envelope (Caddy while the API is down or restarting). */
    data object Unavailable : ApiError

    /** The request didn't complete (an IOException), mapped by the caller. */
    data object Network : ApiError

    /** The request timed out (a SocketTimeoutException), mapped by the caller. */
    data object Timeout : ApiError

    data object Unknown : ApiError
}

object ApiErrorParser {
    private val json = Json { ignoreUnknownKeys = true }
    private val gatewayStatuses = setOf(502, 503, 504)

    fun parse(code: Int, body: ByteArray?): ApiError {
        envelope(code, body)?.let { return it }
        return when {
            code in gatewayStatuses -> ApiError.Unavailable
            code >= 500 -> ApiError.Defined("INTERNAL", code, null)
            else -> ApiError.Unknown
        }
    }

    private fun envelope(code: Int, body: ByteArray?): ApiError.Defined? {
        if (body == null || body.isEmpty()) return null
        val root =
            try {
                json.parseToJsonElement(body.toString(Charsets.UTF_8)) as? JsonObject
            } catch (_: Exception) {
                null
            } ?: return null
        val defined = (root["defined"] as? JsonPrimitive)?.booleanOrNull
        val key = (root["code"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (defined != true || key == null) return null
        val data =
            try {
                root["data"]?.jsonObject
            } catch (_: IllegalArgumentException) {
                null
            }
        return ApiError.Defined(key, code, data)
    }
}
