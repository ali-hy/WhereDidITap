// F-220: the message for an identity failure; everything else keeps the platform's wording (F-253).
package com.budmon.app.identity

import com.budmon.app.R
import com.budmon.app.core.error.ErrorMessages
import com.budmon.app.core.error.Operation
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import kotlinx.serialization.json.JsonPrimitive

object IdentityErrorMessages {
    private val byKey: Map<String, Int> =
        mapOf(
            "INVALID_CREDENTIALS" to R.string.error_invalid_credentials,
            "ACCOUNT_CLOSED" to R.string.error_account_closed,
            "GOOGLE_ACCOUNT_UNKNOWN" to R.string.error_google_account_unknown,
            "GOOGLE_EMAIL_UNVERIFIED" to R.string.error_google_email_unverified,
            "GOOGLE_ACCOUNT_IN_USE" to R.string.error_google_account_in_use,
            "GOOGLE_OTHER_ACCOUNT_LINKED" to R.string.error_google_other_account_linked,
            "GOOGLE_ACCOUNT_NOT_ALLOWED" to R.string.error_google_account_not_allowed,
            "GOOGLE_ACCOUNT_MISMATCH" to R.string.error_google_account_mismatch,
            "GOOGLE_SIGNIN_FAILED" to R.string.error_google_signin_failed,
            "GOOGLE_UNAVAILABLE" to R.string.error_google_unavailable,
            "INVITE_ALLOWANCE_EXHAUSTED" to R.string.error_invite_allowance_exhausted,
            "INVITATIONS_DISABLED" to R.string.error_invitations_disabled,
            "USER_CAP_REACHED" to R.string.error_user_cap_reached,
            "ALREADY_A_USER" to R.string.error_already_a_user,
            "INVITATION_PENDING" to R.string.error_invitation_pending,
            "EMAIL_NOT_INVITABLE" to R.string.error_email_not_invitable,
            "RESEND_LIMIT_REACHED" to R.string.error_resend_limit_reached,
            "EXPORT_IN_PROGRESS" to R.string.error_export_in_progress,
            "EXPORT_LIMIT_REACHED" to R.string.error_export_limit_reached,
            "DELETION_IN_PROGRESS" to R.string.error_deletion_in_progress,
        )

    /** Messages that show an email: from `data.email` (Google keys) or from the caller. */
    private val emailFromData = setOf("GOOGLE_ACCOUNT_UNKNOWN", "GOOGLE_ACCOUNT_MISMATCH")
    private val emailFromCaller = setOf("ALREADY_A_USER", "INVITATION_PENDING")

    /** A message missing its email falls back to the platform's. */
    fun forError(
        error: ApiError,
        op: Operation,
        email: String? = null,
    ): UiText {
        if (error is ApiError.Defined) {
            val resId = byKey[error.key]
            if (resId != null) {
                val needed =
                    when (error.key) {
                        in emailFromData -> (error.data?.get("email") as? JsonPrimitive)?.takeIf { it.isString }?.content
                        in emailFromCaller -> email
                        else -> return UiText(resId)
                    }
                if (needed != null) return UiText(resId, listOf(needed))
            }
        }
        return ErrorMessages.forError(error, op)
    }
}
