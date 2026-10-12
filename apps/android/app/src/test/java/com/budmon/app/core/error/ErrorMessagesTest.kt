// F-253 ErrorMessages: the TP-11.3 table, as Android string resources. TP-13.3.
//
// Shapes per A-344: Operation { Read, Create, Mutation }; UiText(resId, args = emptyList(),
// quantity: Int? = null), where quantity marks a plural. A-346: CLIENT_UPDATE_REQUIRED maps to
// update_required_body.
package com.budmon.app.core.error

import com.budmon.app.R
import com.budmon.app.core.network.ApiError
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class ErrorMessagesTest {
    private fun defined(key: String, status: Int, vararg data: Pair<String, Any>) =
        ApiError.Defined(
            key,
            status,
            if (data.isEmpty()) {
                null
            } else {
                buildJsonObject {
                    for ((k, v) in data) put(k, if (v is Number) JsonPrimitive(v) else JsonPrimitive(v.toString()))
                }
            },
        )

    private fun check(error: ApiError, op: Operation, resId: Int) {
        assertEquals(resId, ErrorMessages.forError(error, op).resId)
    }

    @Test
    fun `TP-13_3 INTERNAL not_applied on a create or mutation is error_generic_not_changed`() {
        check(defined("INTERNAL", 500, "outcome" to "not_applied"), Operation.Create, R.string.error_generic_not_changed)
        check(defined("INTERNAL", 500, "outcome" to "not_applied"), Operation.Mutation, R.string.error_generic_not_changed)
    }

    @Test
    fun `TP-13_3 INTERNAL unknown, or a timeout, on a non-read is error_generic_unknown_outcome`() {
        check(defined("INTERNAL", 500, "outcome" to "unknown"), Operation.Create, R.string.error_generic_unknown_outcome)
        check(ApiError.Timeout, Operation.Create, R.string.error_generic_unknown_outcome)
        check(ApiError.Timeout, Operation.Mutation, R.string.error_generic_unknown_outcome)
    }

    @Test
    fun `TP-13_3 INTERNAL on a read, and a timeout on a read (A-326), are error_generic_read`() {
        check(defined("INTERNAL", 500, "outcome" to "not_applied"), Operation.Read, R.string.error_generic_read)
        check(defined("INTERNAL", 500, "outcome" to "unknown"), Operation.Read, R.string.error_generic_read)
        check(ApiError.Timeout, Operation.Read, R.string.error_generic_read)
    }

    @Test
    fun `TP-13_3 VALIDATION_FAILED is error_validation_form`() {
        check(defined("VALIDATION_FAILED", 400), Operation.Create, R.string.error_validation_form)
    }

    @Test
    fun `TP-13_3 RATE_LIMITED is the error_rate_limited plural with ceil(retryAfterSeconds 60) minutes`() {
        val text = ErrorMessages.forError(defined("RATE_LIMITED", 429, "retryAfterSeconds" to 125), Operation.Create)

        assertEquals(R.plurals.error_rate_limited, text.resId)
        assertEquals(3, text.quantity)
    }

    @Test
    fun `TP-13_3 SERVICE_UNAVAILABLE unknown on a non-read is error_generic_unknown_outcome; otherwise unavailable`() {
        check(defined("SERVICE_UNAVAILABLE", 503, "outcome" to "unknown"), Operation.Create, R.string.error_generic_unknown_outcome)
        check(defined("SERVICE_UNAVAILABLE", 503, "outcome" to "unknown"), Operation.Read, R.string.error_unavailable)
        check(defined("SERVICE_UNAVAILABLE", 503, "outcome" to "not_applied"), Operation.Create, R.string.error_unavailable)
        check(ApiError.Unavailable, Operation.Read, R.string.error_unavailable)
        check(ApiError.Network, Operation.Mutation, R.string.error_unavailable)
    }

    @Test
    fun `TP-13_3 NOT_FOUND and FORBIDDEN`() {
        check(defined("NOT_FOUND", 404), Operation.Read, R.string.error_not_found)
        check(defined("FORBIDDEN", 403), Operation.Mutation, R.string.error_forbidden)
    }

    @Test
    fun `TP-13_3 an unknown key or Unknown is the operation's generic message`() {
        check(defined("TEAPOT", 418), Operation.Read, R.string.error_generic_read)
        check(defined("TEAPOT", 418), Operation.Create, R.string.error_generic_unknown_outcome)
        check(ApiError.Unknown, Operation.Read, R.string.error_generic_read)
        check(ApiError.Unknown, Operation.Mutation, R.string.error_generic_unknown_outcome)
    }

    @Test
    fun `TP-13_3 (A-346) CLIENT_UPDATE_REQUIRED is UiText(update_required_body)`() {
        assertEquals(
            UiText(R.string.update_required_body),
            ErrorMessages.forError(ApiError.Defined("CLIENT_UPDATE_REQUIRED", 426, null), Operation.Read),
        )
    }
}
