// S-3's Android screens (identity LLD §8.2's S-3 signatures and strings, A-70, A-71): SignInScreen,
// OutboxOwnerDialog, SignOutDialog and HomeFirstRunScreen's account menu. TP-3.57's screen rows,
// plus TP-3.57x. Screens get fake lambdas that count their calls; a host that types into a field
// keeps `form` in its own mutableStateOf (P-A-534).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity.ui

import android.content.Context
import android.view.KeyEvent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.R
import com.budmon.app.core.error.UiText
import com.budmon.app.identity.ME
import com.budmon.app.identity.SignInFormState
import com.budmon.app.identity.SignedOutReason
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SignInSignOutScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private fun text(id: Int) = context.getString(id)
    private fun plural(id: Int, n: Int) = context.resources.getQuantityString(id, n, n)

    /** Counts a callback's calls (and keeps the last text, for the field callbacks). */
    private class Counter {
        var calls = 0
        var last: String? = null
        val call: () -> Unit = { calls += 1 }
        val text: (String) -> Unit = {
            calls += 1
            last = it
        }
    }

    private fun show(content: @Composable () -> Unit) {
        compose.setContent { AppTheme(ThemeSetting.LIGHT) { content() } }
    }

    private fun form(
        email: String = "",
        password: String = "",
        emailError: Int? = null,
        formError: UiText? = null,
        busy: Boolean = false,
    ) = SignInFormState(
        email = email,
        password = password,
        emailError = emailError,
        passwordError = null,
        formError = formError,
        busy = busy,
        ownerDialog = null,
    )

    /** The field whose label (content description) is [labelId], read-only or not. */
    private fun field(labelId: Int): SemanticsNodeInteraction =
        compose.onNode(hasContentDescription(text(labelId)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText))
            .performScrollTo()

    /** The Sign in button (the heading has the same text). */
    private fun signInButton(): SemanticsNodeInteraction =
        compose.onNode(hasText(text(R.string.signin_submit)) and hasClickAction()).performScrollTo()

    private val progress =
        SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo, ProgressBarRangeInfo.Indeterminate)

    // ---- SignInScreen (F-208) ----

    @Test
    fun `TP-3_57 SignInScreen busy - Sign in shows progress and stays enabled, a tap doesn't submit, fields read-only`() {
        val submit = Counter()
        show {
            SignInScreen(
                reason = SignedOutReason.None,
                isOnline = true,
                form = form(email = ME.email, password = "secret", busy = true),
                onEmailChange = {},
                onPasswordChange = {},
                onSubmit = submit.call,
                onHaveLink = {},
                onPrivacy = {},
            )
        }

        compose.onNode(progress, useUnmergedTree = true).assertExists()
        signInButton().assertIsEnabled().performClick()
        assertEquals(0, submit.calls)
        val readOnly = SemanticsMatcher.expectValue(SemanticsProperties.IsEditable, false)
        field(R.string.signin_email).assert(readOnly)
        field(R.string.signin_password).assert(readOnly)
    }

    @Test
    fun `TP-3_57x SignInScreen idle - typing calls onEmailChange and onPasswordChange, Sign in calls onSubmit, errors shown`() {
        val email = Counter()
        val password = Counter()
        val submit = Counter()
        // The host keeps `form` in its own state, updated by the lambdas (P-A-534).
        val state = mutableStateOf(form(emailError = R.string.form_email_invalid, formError = UiText(R.string.error_invalid_credentials)))
        show {
            SignInScreen(
                reason = SignedOutReason.None,
                isOnline = true,
                form = state.value,
                onEmailChange = {
                    email.text(it)
                    state.value = state.value.copy(email = it)
                },
                onPasswordChange = {
                    password.text(it)
                    state.value = state.value.copy(password = it)
                },
                onSubmit = submit.call,
                onHaveLink = {},
                onPrivacy = {},
            )
        }

        compose.onNodeWithText(text(R.string.form_email_invalid)).assertExists()
        compose.onNodeWithText(text(R.string.error_invalid_credentials)).assertExists()
        field(R.string.signin_email).performTextInput("m")
        field(R.string.signin_password).performTextInput("p")
        signInButton().performClick()

        assertEquals("m", email.last)
        assertEquals("p", password.last)
        assertEquals(1, submit.calls)
    }

    // ---- OutboxOwnerDialog (F-205's D-23 dialog) ----

    @Test
    fun `TP-3_57 OutboxOwnerDialog for 3 - the D-23 text, Delete and continue and Cancel call their lambdas`() {
        val delete = Counter()
        val cancel = Counter()
        show { OutboxOwnerDialog(count = 3, onDelete = delete.call, onCancel = cancel.call) }

        compose.onNodeWithText(plural(R.plurals.outbox_other_user, 3)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.outbox_delete_continue)).performClick()
        assertEquals(1, delete.calls)
        assertEquals(0, cancel.calls)
        compose.onNodeWithText(text(R.string.outbox_cancel)).performClick()
        assertEquals(1, cancel.calls)
        assertEquals(1, delete.calls)
    }

    @Test
    fun `TP-3_57 OutboxOwnerDialog dismissed with Back - onCancel once, onDelete never (A-86)`() {
        val delete = Counter()
        val cancel = Counter()
        show { OutboxOwnerDialog(count = 3, onDelete = delete.call, onCancel = cancel.call) }
        compose.onNodeWithText(plural(R.plurals.outbox_other_user, 3)).assertIsDisplayed()

        // Back goes to the dialog's window, as a real key press does.
        val dialogRoot = (compose.onNode(isDialog()).fetchSemanticsNode().root as ViewRootForTest).view.rootView
        compose.runOnUiThread {
            dialogRoot.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK))
            dialogRoot.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK))
        }
        compose.waitForIdle()

        assertEquals(1, cancel.calls)
        assertEquals(0, delete.calls)
    }

    // ---- SignOutDialog (F-218's J-10 dialog) ----

    private fun showSignOutDialog(isOnline: Boolean, sync: Counter = Counter(), anyway: Counter = Counter(), cancel: Counter = Counter()) =
        show {
            SignOutDialog(
                unsynced = 2,
                isOnline = isOnline,
                onSyncNow = sync.call,
                onSignOutAnyway = anyway.call,
                onCancel = cancel.call,
            )
        }

    @Test
    fun `TP-3_57 SignOutDialog online for 2 - the J-10 text, Sync now, Sign out anyway and Cancel`() {
        showSignOutDialog(isOnline = true)

        compose.onNodeWithText(plural(R.plurals.signout_unsynced, 2)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.signout_sync_now)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.signout_anyway)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.signout_cancel)).assertIsDisplayed()
    }

    @Test
    fun `TP-3_57 SignOutDialog offline for 2 - no Sync now, Sign out anyway and Cancel`() {
        showSignOutDialog(isOnline = false)

        compose.onNodeWithText(plural(R.plurals.signout_unsynced, 2)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.signout_sync_now)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.signout_anyway)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.signout_cancel)).assertIsDisplayed()
    }

    @Test
    fun `TP-3_57x SignOutDialog - Sync now, Sign out anyway and Cancel each call their own lambda`() {
        val sync = Counter()
        val anyway = Counter()
        val cancel = Counter()
        showSignOutDialog(isOnline = true, sync, anyway, cancel)

        compose.onNodeWithText(text(R.string.signout_sync_now)).performClick()
        assertEquals(listOf(1, 0, 0), listOf(sync.calls, anyway.calls, cancel.calls))
        compose.onNodeWithText(text(R.string.signout_anyway)).performClick()
        assertEquals(listOf(1, 1, 0), listOf(sync.calls, anyway.calls, cancel.calls))
        compose.onNodeWithText(text(R.string.signout_cancel)).performClick()
        assertEquals(listOf(1, 1, 1), listOf(sync.calls, anyway.calls, cancel.calls))
    }

    // ---- HomeFirstRunScreen's account menu (A-71) ----

    @Test
    fun `TP-3_57 HomeFirstRunScreen - the Account button opens a menu whose Sign out calls onSignOut`() {
        val signOut = Counter()
        show { HomeFirstRunScreen(me = ME, onSignOut = signOut.call) }

        compose.onNodeWithText(text(R.string.menu_sign_out)).assertDoesNotExist()
        compose.onNodeWithContentDescription(text(R.string.menu_account)).assertIsDisplayed().performClick()
        compose.onNodeWithText(text(R.string.menu_sign_out)).assertIsDisplayed().performClick()

        assertEquals(1, signOut.calls)
    }

    // ---- strings (§8.2's S-3 Android strings) ----

    @Test
    fun `TP-3_57x the S-3 strings have the texts of §8_2`() {
        val expected = mapOf<Int, String>(
            R.string.signin_email to "Email",
            R.string.signin_password to "Password",
            R.string.signin_submit to "Sign in",
            R.string.form_email_required to "Enter your email.",
            R.string.form_email_invalid to "Enter an email address like name@example.com.",
            R.string.form_password_required to "Enter your password.",
            R.string.menu_account to "Account",
            R.string.menu_sign_out to "Sign out",
            R.string.outbox_cancel to "Cancel",
            R.string.signout_cancel to "Cancel",
            R.string.outbox_delete_continue to "Delete and continue",
            R.string.signout_sync_now to "Sync now",
            R.string.signout_anyway to "Sign out anyway",
        )
        for ((id, value) in expected) assertEquals(value, text(id))
        assertEquals(
            "2 entries haven't synced yet. If you sign out now, they stay on this phone and sync the next time you sign in.",
            plural(R.plurals.signout_unsynced, 2),
        )
        assertEquals(
            "This phone has 3 unsynced entries from another user. Delete them to continue?",
            plural(R.plurals.outbox_other_user, 3),
        )
    }
}
