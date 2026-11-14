// F-253: the message for a failure, by operation; the same mapping as the web's F-203.
package com.budmon.app.core.error

import com.budmon.app.R
import com.budmon.app.core.network.ApiError
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.ceil

enum class Operation { Read, Create, Mutation }

/** A string resource and its arguments; a non-null [quantity] means [resId] is a plurals resource. */
data class UiText(val resId: Int, val args: List<Any> = emptyList(), val quantity: Int? = null)

object ErrorMessages {
    fun forError(error: ApiError, op: Operation): UiText {
        val read = op == Operation.Read
        return when (error) {
            // A-326: a timed-out read changed nothing.
            ApiError.Timeout, ApiError.Unknown -> {
                generic(op)
            }

            ApiError.Unavailable, ApiError.Network -> {
                UiText(R.string.error_unavailable)
            }

            is ApiError.Defined -> {
                when (error.key) {
                    "INTERNAL" -> {
                        when {
                            read -> UiText(R.string.error_generic_read)
                            outcomeOf(error.data) == "not_applied" -> UiText(R.string.error_generic_not_changed)
                            else -> UiText(R.string.error_generic_unknown_outcome)
                        }
                    }

                    "VALIDATION_FAILED" -> {
                        UiText(R.string.error_validation_form)
                    }

                    "RATE_LIMITED" -> {
                        val minutes = ceil(retryAfterOf(error.data) / 60.0).toInt()
                        UiText(R.plurals.error_rate_limited, listOf(minutes), quantity = minutes)
                    }

                    "SERVICE_UNAVAILABLE" -> {
                        if (!read && outcomeOf(error.data) == "unknown") {
                            UiText(R.string.error_generic_unknown_outcome)
                        } else {
                            UiText(R.string.error_unavailable)
                        }
                    }

                    "NOT_FOUND" -> {
                        UiText(R.string.error_not_found)
                    }

                    "FORBIDDEN" -> {
                        UiText(R.string.error_forbidden)
                    }

                    // A-346: the caller also marks the update required, so the full screen follows.
                    "CLIENT_UPDATE_REQUIRED" -> {
                        UiText(R.string.update_required_body)
                    }

                    else -> {
                        generic(op)
                    }
                }
            }
        }
    }

    /** The generic message for the operation: nothing changed on a read; unknown otherwise. */
    private fun generic(op: Operation): UiText =
        UiText(if (op == Operation.Read) R.string.error_generic_read else R.string.error_generic_unknown_outcome)

    private fun outcomeOf(data: JsonObject?): String? = (data?.get("outcome") as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** `retryAfterSeconds`, or 60 when it's missing, not finite or not positive (A-404). */
    private fun retryAfterOf(data: JsonObject?): Double {
        val value = (data?.get("retryAfterSeconds") as? JsonPrimitive)?.doubleOrNull
        return if (value != null && value.isFinite() && value > 0) value else 60.0
    }
}
