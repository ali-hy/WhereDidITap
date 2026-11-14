// F-220 IdentityErrorMessages (identity LLD §4.15, A-16). TP-0.43, plus extra cases TP-0.43x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Shapes: forError(error: ApiError, op: Operation, email: String? = null): UiText. A message missing
// the email it shows falls back to F-253's ErrorMessages.forError(error, op).
package com.budmon.app.identity

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.budmon.app.core.error.ErrorMessages
import com.budmon.app.core.error.Operation
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class IdentityErrorMessagesTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun defined(key: String, status: Int, vararg data: Pair<String, Any>) = ApiError.Defined(
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

    /** The English string a UiText shows (plurals by quantity). */
    private fun resolve(text: UiText): String {
        val args = text.args.toTypedArray()
        return if (text.quantity != null) {
            context.resources.getQuantityString(text.resId, text.quantity, *args)
        } else {
            context.getString(text.resId, *args)
        }
    }

    // --- TP-0.43 (A-16)

    @Test
    fun `TP-0_43 ALREADY_A_USER with an email, then without`() {
        val error = defined("ALREADY_A_USER", 409)

        assertEquals("a@x.test already has an account.", resolve(IdentityErrorMessages.forError(error, Operation.Create, "a@x.test")))
        val fallback = IdentityErrorMessages.forError(error, Operation.Create)
        assertEquals(ErrorMessages.forError(error, Operation.Create), fallback)
        assertFalse(resolve(fallback).contains("%1\$s"))
    }

    @Test
    fun `TP-0_43 INVITATION_PENDING with an email, then without`() {
        val error = defined("INVITATION_PENDING", 409)

        assertEquals(
            "a@x.test already has a pending invitation.",
            resolve(IdentityErrorMessages.forError(error, Operation.Create, "a@x.test")),
        )
        val fallback = IdentityErrorMessages.forError(error, Operation.Create)
        assertEquals(ErrorMessages.forError(error, Operation.Create), fallback)
        assertFalse(resolve(fallback).contains("%1\$s"))
    }

    @Test
    fun `TP-0_43 GOOGLE_ACCOUNT_MISMATCH with data email, then without`() {
        val withEmail = defined("GOOGLE_ACCOUNT_MISMATCH", 400, "email" to "a@x.test")
        val without = defined("GOOGLE_ACCOUNT_MISMATCH", 400)

        assertEquals(
            "Choose the Google account you connected (a@x.test).",
            resolve(IdentityErrorMessages.forError(withEmail, Operation.Mutation)),
        )
        val fallback = IdentityErrorMessages.forError(without, Operation.Mutation)
        assertEquals(ErrorMessages.forError(without, Operation.Mutation), fallback)
        assertFalse(resolve(fallback).contains("%1\$s"))
    }

    // --- TP-0.43x: the rest of F-220's map and its fallback

    @Test
    fun `TP-0_43x INVALID_CREDENTIALS, then GOOGLE_ACCOUNT_UNKNOWN with data email`() {
        assertEquals(
            "Email or password is incorrect.",
            resolve(IdentityErrorMessages.forError(defined("INVALID_CREDENTIALS", 401), Operation.Mutation)),
        )
        assertEquals(
            "There's no account for a@x.test. You need an invitation: ask someone who already has an account to invite you.",
            resolve(
                IdentityErrorMessages.forError(
                    defined("GOOGLE_ACCOUNT_UNKNOWN", 404, "email" to "a@x.test"),
                    Operation.Mutation,
                ),
            ),
        )
    }

    @Test
    fun `TP-0_43x GOOGLE_ACCOUNT_UNKNOWN without data email falls back to F-253`() {
        val error = defined("GOOGLE_ACCOUNT_UNKNOWN", 404)

        assertEquals(ErrorMessages.forError(error, Operation.Mutation), IdentityErrorMessages.forError(error, Operation.Mutation))
    }

    @Test
    fun `TP-0_43x the caller's email is not used for the Google keys, and data email not for ALREADY_A_USER`() {
        val mismatch = defined("GOOGLE_ACCOUNT_MISMATCH", 400)
        val already = defined("ALREADY_A_USER", 409, "email" to "server@x.test")

        assertEquals(
            ErrorMessages.forError(mismatch, Operation.Mutation),
            IdentityErrorMessages.forError(mismatch, Operation.Mutation, "a@x.test"),
        )
        assertEquals(ErrorMessages.forError(already, Operation.Create), IdentityErrorMessages.forError(already, Operation.Create))
    }

    @Test
    fun `TP-0_43x RATE_LIMITED, Network and a key without its own message equal F-253's message`() {
        val cases = listOf(
            defined("RATE_LIMITED", 429, "retryAfterSeconds" to 90) to Operation.Mutation,
            ApiError.Network to Operation.Read,
            defined("REFRESH_INVALID", 401) to Operation.Read,
            defined("SOMETHING_ELSE", 409) to Operation.Create,
        )

        for ((error, op) in cases) {
            assertEquals(error.toString(), ErrorMessages.forError(error, op), IdentityErrorMessages.forError(error, op))
        }
    }

    /** §8.2's identity error strings in English (name-free, A-23), with the email supplied where one is shown. */
    private val english = listOf(
        "INVALID_CREDENTIALS" to "Email or password is incorrect.",
        "ACCOUNT_CLOSED" to "This account has been closed.",
        "GOOGLE_ACCOUNT_UNKNOWN" to
            "There's no account for a@x.test. You need an invitation: ask someone who already has an account to invite you.",
        "GOOGLE_EMAIL_UNVERIFIED" to
            "Google hasn't confirmed this email address. Sign in with your password, or use your invitation.",
        "GOOGLE_ACCOUNT_IN_USE" to "This Google account is already used by another account.",
        "GOOGLE_OTHER_ACCOUNT_LINKED" to
            "Your account is connected to a different Google account. Use that one, or your password.",
        "GOOGLE_ACCOUNT_NOT_ALLOWED" to "This Google account can't be used here.",
        "GOOGLE_ACCOUNT_MISMATCH" to "Choose the Google account you connected (a@x.test).",
        "GOOGLE_SIGNIN_FAILED" to "Google sign-in didn't complete. Try again.",
        "GOOGLE_UNAVAILABLE" to "Couldn't reach Google. Try again, or use your password.",
        "INVITE_ALLOWANCE_EXHAUSTED" to "You've used all your invitations. The administrator can give you more.",
        "INVITATIONS_DISABLED" to "Sending invitations isn't available for your account.",
        "USER_CAP_REACHED" to "There's no room for new people right now, so no new invitations can be sent.",
        "ALREADY_A_USER" to "a@x.test already has an account.",
        "INVITATION_PENDING" to "a@x.test already has a pending invitation.",
        "EMAIL_NOT_INVITABLE" to "This address can't be invited.",
        "RESEND_LIMIT_REACHED" to "You can resend this invitation again tomorrow.",
        "EXPORT_IN_PROGRESS" to "Preparing your export…",
        "EXPORT_LIMIT_REACHED" to "You can request another export tomorrow.",
        "DELETION_IN_PROGRESS" to "Your account is already being deleted.",
    )

    @Test
    fun `TP-0_43x every identity key resolves to its English string, none containing a placeholder`() {
        for ((key, text) in english) {
            val resolved = resolve(
                IdentityErrorMessages.forError(defined(key, 409, "email" to "a@x.test"), Operation.Mutation, "a@x.test"),
            )

            assertEquals(key, text, resolved)
            assertFalse(key, resolved.contains("%1\$s"))
        }
    }
}
