// S-4's Android screens (identity LLD §8.2's S-4 signatures and strings, A-99, A-100): TwoStepScreen
// and TwoStepRoute (F-209), ConfirmItsYouSheet and ConfirmItsYouHost (F-216). TP-4.35's screen rows,
// plus TP-4.35x. ConfirmItsYouHost runs the real ConfirmationCoordinator, with withConfirmation
// launched on the main thread.
// Screens are rendered by hosts that keep `form` in a mutableStateOf updated by the lambdas
// (P-A-534). TwoStepRoute runs a real TwoStepViewModel over a MockK AuthRepository and the real
// OutboxOwnerGuard (MockK DAO, empty outbox), as TP-4.35 says.
// TP-4.45 (b)'s sheet half: Cancel disabled while form.busy (A-104). TP-4.45x: Cancel enabled when
// not busy; TwoStepRoute's owner dialog (MockK DAO with entries of another user, as TP-4.45 says)
// whose Cancel pops through onBack (A-104 G-1: "TwoStepRoute passes onBack").
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity.ui

import android.content.Context
import android.view.KeyEvent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.R
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.identity.ApiException
import com.budmon.app.identity.AuthRepository
import com.budmon.app.identity.ConfirmFactor
import com.budmon.app.identity.ConfirmFormState
import com.budmon.app.identity.ConfirmationCoordinator
import com.budmon.app.identity.ME
import com.budmon.app.identity.OutboxOwnerGuard
import com.budmon.app.identity.PendingSignIn
import com.budmon.app.identity.TwoStepChallenge
import com.budmon.app.identity.TwoStepFormState
import com.budmon.app.identity.TwoStepVerified
import com.budmon.app.identity.TwoStepViewModel
import com.budmon.app.identity.storedSession
import com.budmon.app.identity.store.TokenStore
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class TwoStepScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private fun text(id: Int) = context.getString(id)

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

    private fun twoStepForm(
        useRecovery: Boolean = false,
        value: String = "",
        error: Int? = null,
        formError: UiText? = null,
        showRecoveryHint: Boolean = false,
    ) = TwoStepFormState(
        useRecovery = useRecovery,
        value = value,
        error = error,
        formError = formError,
        busy = false,
        ownerDialog = null,
        showRecoveryHint = showRecoveryHint,
    )

    private fun confirmForm(useRecovery: Boolean = false, value: String = "", error: Int? = null) =
        ConfirmFormState(useRecovery = useRecovery, value = value, error = error, formError = null, busy = false)

    /** The editable field whose label (content description, P-A-524's AppTextField) is [labelId]. */
    private fun field(labelId: Int): SemanticsNodeInteraction =
        compose.onNode(hasContentDescription(text(labelId)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText))

    private val emptyText = SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString(""))

    /** Scrolls the node into view when its screen scrolls (a tap lands only inside the window). */
    private fun SemanticsNodeInteraction.inView(): SemanticsNodeInteraction {
        var parent = fetchSemanticsNode().parent
        while (parent != null) {
            if (parent.config.contains(SemanticsActions.ScrollBy)) return performScrollTo()
            parent = parent.parent
        }
        return this
    }

    private fun button(labelId: Int): SemanticsNodeInteraction =
        compose.onNode(hasText(text(labelId)) and hasClickAction()).inView()

    // ---- TwoStepScreen (F-209) ----

    /** The host's own focusable element (tag "elsewhere"), so a test can move focus off the field. */
    private val elsewhere = FocusRequester()

    /** A host keeping the form in its own state, with a focusable element above the screen. */
    private fun showTwoStep(
        state: androidx.compose.runtime.MutableState<TwoStepFormState>,
        submit: Counter = Counter(),
        toggle: Counter = Counter(),
        back: Counter = Counter(),
        values: Counter = Counter(),
    ) = show {
        Box(Modifier.size(1.dp).testTag("elsewhere").focusRequester(elsewhere).focusable())
        TwoStepScreen(
            form = state.value,
            onValueChange = {
                values.text(it)
                state.value = state.value.copy(value = it)
            },
            onToggleRecovery = {
                toggle.call()
                state.value = state.value.copy(useRecovery = !state.value.useRecovery, value = "")
            },
            onSubmit = submit.call,
            onBack = back.call,
        )
    }

    @Test
    fun `TP-4_35 TwoStepScreen first composition - the code field is focused`() {
        showTwoStep(mutableStateOf(twoStepForm()))

        field(R.string.twostep_code).assertIsFocused()
    }

    @Test
    fun `TP-4_35 TwoStepScreen after a wrong code - the field refocused, value cleared, twostep_code_wrong shown`() {
        val state = mutableStateOf(twoStepForm(value = "111111"))
        showTwoStep(state)
        field(R.string.twostep_code).assertIsFocused()
        compose.runOnIdle { elsewhere.requestFocus() }
        compose.onNodeWithTag("elsewhere").assertIsFocused()
        field(R.string.twostep_code).assertIsNotFocused()

        // What TwoStepViewModel does on TWO_STEP_CODE_INVALID.
        compose.runOnIdle { state.value = state.value.copy(value = "", error = R.string.twostep_code_wrong) }

        field(R.string.twostep_code).assertIsFocused()
        field(R.string.twostep_code).assert(emptyText)
        compose.onNodeWithText(text(R.string.twostep_code_wrong)).assertExists()
    }

    @Test
    fun `TP-4_35x TwoStepScreen - typing calls onValueChange, Verify calls onSubmit, Back to sign in calls onBack`() {
        val submit = Counter()
        val back = Counter()
        val values = Counter()
        showTwoStep(mutableStateOf(twoStepForm()), submit = submit, back = back, values = values)

        field(R.string.twostep_code).performTextInput("1")
        button(R.string.twostep_verify).performClick()
        button(R.string.twostep_back).performClick()

        assertEquals("1", values.last)
        assertEquals(1, submit.calls)
        assertEquals(1, back.calls)
    }

    @Test
    fun `TP-4_35x TwoStepScreen - Use a recovery code instead calls onToggleRecovery, the field becomes Recovery code with Use a code from your app`() {
        val toggle = Counter()
        showTwoStep(mutableStateOf(twoStepForm()), toggle = toggle)

        button(R.string.twostep_use_recovery).performClick()

        assertEquals(1, toggle.calls)
        field(R.string.twostep_recovery).assertExists()
        field(R.string.twostep_code).assertDoesNotExist()
        button(R.string.twostep_use_code).assertIsDisplayed()
    }

    @Test
    fun `TP-4_35x TwoStepScreen - formError shown`() {
        showTwoStep(mutableStateOf(twoStepForm(formError = UiText(R.string.twostep_timeout))))

        compose.onNodeWithText(text(R.string.twostep_timeout)).assertExists()
    }

    @Test
    fun `TP-4_35x TwoStepScreen rate-limited - formError, then twostep_limit_recovery as a second line below it (A-100)`() {
        val limited = UiText(R.plurals.error_rate_limited, listOf(2), quantity = 2)
        showTwoStep(mutableStateOf(twoStepForm(formError = limited, showRecoveryHint = true)))

        val first = compose.onNodeWithText(context.resources.getQuantityString(R.plurals.error_rate_limited, 2, 2)).fetchSemanticsNode()
        val second = compose.onNodeWithText(text(R.string.twostep_limit_recovery)).fetchSemanticsNode()
        assertTrue("the hint is below the rate-limit text", second.boundsInRoot.top >= first.boundsInRoot.bottom)
    }

    @Test
    fun `TP-4_35x TwoStepScreen without showRecoveryHint - no twostep_limit_recovery`() {
        showTwoStep(mutableStateOf(twoStepForm(formError = UiText(R.string.twostep_timeout))))

        compose.onNodeWithText(text(R.string.twostep_limit_recovery)).assertDoesNotExist()
    }

    // ---- TwoStepRoute (F-209) with the real view model ----

    @Test
    fun `TP-4_35 TwoStepRoute, a wrong code - verifyTwoStep(challenge, 111111, null), twostep_code_wrong shown, field empty and focused`() {
        val challenge = TwoStepChallenge("bmc_" + "C".repeat(43), Instant.parse("2026-11-15T10:05:00Z"), "mona@example.com", null)
        val repository = mockk<AuthRepository> {
            coEvery { verifyTwoStep(challenge, "111111", null) } throws
                ApiException(ApiError.Defined("TWO_STEP_CODE_INVALID", 400, buildJsonObject { put("attemptsLeft", 4) }))
        }
        val dao = mockk<OutboxDao> { coEvery { countAll() } returns 0 }
        val guard = OutboxOwnerGuard(dao, mockk(relaxed = true), mockk(relaxed = true), repository)
        val vm = TwoStepViewModel(repository, guard)
        vm.start(challenge)
        val back = Counter()
        show { TwoStepRoute(viewModel = vm, savePassword = { _, _ -> }, onSignedIn = {}, onEnded = {}, onBack = back.call) }

        field(R.string.twostep_code).performTextInput("111111")
        button(R.string.twostep_verify).performClick()
        compose.waitForIdle()

        coVerify(exactly = 1) { repository.verifyTwoStep(challenge, "111111", null) }
        compose.onNodeWithText(text(R.string.twostep_code_wrong)).assertExists()
        field(R.string.twostep_code).assert(emptyText)
        field(R.string.twostep_code).assertIsFocused()
        assertEquals(0, back.calls)
    }

    // ---- ConfirmItsYouSheet (F-216) ----

    private fun showSheet(
        factor: ConfirmFactor,
        state: androidx.compose.runtime.MutableState<ConfirmFormState>,
        submit: Counter = Counter(),
        cancel: Counter = Counter(),
        toggle: Counter = Counter(),
        values: Counter = Counter(),
    ) = show {
        ConfirmItsYouSheet(
            factor = factor,
            form = state.value,
            onValueChange = {
                values.text(it)
                state.value = state.value.copy(value = it)
            },
            onToggleRecovery = {
                toggle.call()
                state.value = state.value.copy(useRecovery = !state.value.useRecovery, value = "")
            },
            onSubmit = submit.call,
            onCancel = cancel.call,
        )
    }

    @Test
    fun `TP-4_35x ConfirmItsYouSheet TwoStep - Confirm it's you, the Code field, Confirm calls onSubmit, Cancel calls onCancel`() {
        val submit = Counter()
        val cancel = Counter()
        val values = Counter()
        showSheet(ConfirmFactor.TwoStep, mutableStateOf(confirmForm()), submit = submit, cancel = cancel, values = values)

        compose.onNodeWithText(text(R.string.confirm_title)).assertIsDisplayed()
        field(R.string.twostep_code).performTextInput("123456")
        button(R.string.confirm_submit).performClick()
        assertEquals("123456", values.last)
        assertEquals(1, submit.calls)
        assertEquals(0, cancel.calls)

        button(R.string.confirm_cancel).performClick()
        assertEquals(1, cancel.calls)
        assertEquals(1, submit.calls)
    }

    @Test
    fun `TP-4_35x ConfirmItsYouSheet TwoStep - Use a recovery code instead calls onToggleRecovery, then the Recovery code field and Use a code from your app`() {
        val toggle = Counter()
        showSheet(ConfirmFactor.TwoStep, mutableStateOf(confirmForm()), toggle = toggle)

        button(R.string.twostep_use_recovery).performClick()

        assertEquals(1, toggle.calls)
        field(R.string.twostep_recovery).assertExists()
        button(R.string.twostep_use_code).assertIsDisplayed()
    }

    @Test
    fun `TP-4_35x ConfirmItsYouSheet TwoStep with error twostep_code_wrong - the message shown`() {
        showSheet(ConfirmFactor.TwoStep, mutableStateOf(confirmForm(error = R.string.twostep_code_wrong)))

        compose.onNodeWithText(text(R.string.twostep_code_wrong)).assertExists()
    }

    @Test
    fun `TP-4_35x ConfirmItsYouSheet Password - the Password field (confirm_password), no recovery link`() {
        val submit = Counter()
        showSheet(ConfirmFactor.Password, mutableStateOf(confirmForm()), submit = submit)

        compose.onNodeWithText(text(R.string.confirm_title)).assertIsDisplayed()
        field(R.string.confirm_password).assertExists()
        compose.onNodeWithText(text(R.string.twostep_use_recovery)).assertDoesNotExist()
        button(R.string.confirm_submit).performClick()
        assertEquals(1, submit.calls)
    }

    @Test
    fun `TP-4_35x ConfirmItsYouSheet dismissed with Back - onCancel once, onSubmit never (dismiss = cancel)`() {
        val submit = Counter()
        val cancel = Counter()
        showSheet(ConfirmFactor.TwoStep, mutableStateOf(confirmForm()), submit = submit, cancel = cancel)
        compose.onNodeWithText(text(R.string.confirm_title)).assertIsDisplayed()

        // Back goes to the sheet's window, as a real key press does.
        val sheetRoot =
            (compose.onNodeWithText(text(R.string.confirm_title)).fetchSemanticsNode().root as ViewRootForTest).view.rootView
        compose.runOnUiThread {
            sheetRoot.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK))
            sheetRoot.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK))
        }
        compose.waitForIdle()

        assertEquals(1, cancel.calls)
        assertEquals(0, submit.calls)
    }

    @Test
    fun `TP-4_45 ConfirmItsYouSheet with form busy - Cancel disabled (A-104)`() {
        showSheet(ConfirmFactor.Password, mutableStateOf(confirmForm().copy(value = "violet staircase umbrella", busy = true)))
        compose.onNodeWithText(text(R.string.confirm_title)).assertIsDisplayed()

        button(R.string.confirm_cancel).assertIsNotEnabled()
    }

    @Test
    fun `TP-4_45x ConfirmItsYouSheet code factor with form busy - Cancel disabled (A-104)`() {
        showSheet(ConfirmFactor.TwoStep, mutableStateOf(confirmForm().copy(value = "123456", busy = true)))
        compose.onNodeWithText(text(R.string.confirm_title)).assertIsDisplayed()

        button(R.string.confirm_cancel).assertIsNotEnabled()
    }

    @Test
    fun `TP-4_45x ConfirmItsYouSheet not busy - Cancel enabled`() {
        showSheet(ConfirmFactor.Password, mutableStateOf(confirmForm()))

        button(R.string.confirm_cancel).assertIsEnabled()
    }

    // ---- TwoStepRoute's owner dialog (A-104) ----

    @Test
    fun `TP-4_45x TwoStepRoute, the owner dialog's Cancel - onBack once, the pending sign-in abandoned, not signed in (A-104)`() {
        val challenge = TwoStepChallenge("bmc_" + "C".repeat(43), Instant.parse("2026-11-15T10:05:00Z"), "mona@example.com", null)
        val pending = PendingSignIn(
            session = storedSession(Instant.parse("2026-12-15T10:00:00Z")),
            deviceToken = "bmd_" + "D".repeat(43),
            me = ME,
        )
        val repository = mockk<AuthRepository> {
            coEvery { verifyTwoStep(challenge, "123456", null) } returns TwoStepVerified(pending, null)
            coEvery { abandonSignIn(pending) } returns Unit
        }
        // Two entries of another user.
        val dao = mockk<OutboxDao> { coEvery { countAll() } returns 2 }
        val tokenStore = mockk<TokenStore>(relaxed = true) {
            coEvery { outboxOwnerUserId() } returns "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a77"
        }
        val guard = OutboxOwnerGuard(dao, tokenStore, mockk(relaxed = true), repository)
        val vm = TwoStepViewModel(repository, guard)
        vm.start(challenge)
        val back = Counter()
        val signedIn = Counter()
        show {
            TwoStepRoute(viewModel = vm, savePassword = { _, _ -> }, onSignedIn = { signedIn.call() }, onEnded = {}, onBack = back.call)
        }

        field(R.string.twostep_code).performTextInput("123456")
        button(R.string.twostep_verify).performClick()
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            vm.form.ownerDialog != null
        }
        compose.onNode(hasText(text(R.string.outbox_cancel)) and hasClickAction()).performClick()
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            back.calls > 0
        }

        assertEquals(1, back.calls)
        coVerify(exactly = 1) { repository.abandonSignIn(pending) }
        assertEquals(0, signedIn.calls)
        assertNull(vm.form.ownerDialog)
    }

    // ---- ConfirmItsYouHost (F-216) with the real coordinator ----

    @Test
    fun `TP-4_35 ConfirmItsYouHost - no sheet without a request, the sheet while request is non-null, Back cancels (withConfirmation returns null)`() {
        val coordinator = ConfirmationCoordinator(mockk<AuthRepository>())
        val calls = AtomicInteger(0)
        var outcome: Result<String?>? = null
        val scope = CoroutineScope(Dispatchers.Main.immediate)
        show { ConfirmItsYouHost(coordinator) }
        compose.onNodeWithText(text(R.string.confirm_title)).assertDoesNotExist()

        compose.runOnUiThread {
            scope.launch {
                outcome = runCatching {
                    coordinator.withConfirmation<String> {
                        calls.incrementAndGet()
                        throw ApiException(ApiError.Defined("CONFIRMATION_REQUIRED", 403, buildJsonObject { put("factor", "two_step") }))
                    }
                }
            }
        }
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            coordinator.request.value != null
        }
        compose.onNodeWithText(text(R.string.confirm_title)).assertIsDisplayed()
        field(R.string.twostep_code).assertExists()

        // Back goes to the sheet's window, as a real key press does.
        val sheetRoot =
            (compose.onNodeWithText(text(R.string.confirm_title)).fetchSemanticsNode().root as ViewRootForTest).view.rootView
        compose.runOnUiThread {
            sheetRoot.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK))
            sheetRoot.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK))
        }
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            outcome != null
        }

        assertNull(outcome!!.getOrThrow())
        assertEquals("run() not called again", 1, calls.get())
        assertNull(coordinator.request.value)
        compose.waitForIdle()
        compose.onNodeWithText(text(R.string.confirm_title)).assertDoesNotExist()
        scope.cancel()
    }

    // ---- strings (§8.1's texts, snake case per §8.2's S-4 block, A-99) ----

    @Test
    fun `TP-4_35x the S-4 strings have the texts of §8_1 and §8_2`() {
        val expected = mapOf<Int, String>(
            R.string.twostep_title to "Two-step verification",
            R.string.twostep_prompt to "Enter the 6-digit code from your authenticator app.",
            R.string.twostep_code to "Code",
            R.string.twostep_recovery to "Recovery code",
            R.string.twostep_use_recovery to "Use a recovery code instead",
            R.string.twostep_use_code to "Use a code from your app",
            R.string.twostep_verify to "Verify",
            R.string.twostep_back to "Back to sign in",
            R.string.twostep_code_invalid to "Enter the 6 digits from your app.",
            // A-99, confirmed by the owner 2026-11-20.
            R.string.twostep_recovery_invalid to "Enter a code like 7KQ2-M3XD-4TRA.",
            R.string.twostep_code_wrong to "That code didn't work. Check your app and try again.",
            R.string.twostep_too_many to "Too many attempts. Sign in again.",
            R.string.twostep_timeout to "This sign-in timed out. Sign in again.",
            R.string.twostep_limit_recovery to "You can still use a recovery code.",
            R.string.confirm_title to "Confirm it's you",
            // A-99 (HLD J-15), confirmed by the owner 2026-11-20.
            R.string.confirm_submit to "Confirm",
            R.string.confirm_cancel to "Cancel",
            R.string.confirm_password to "Password",
            R.string.twostep_no_app to "No authenticator app found. Enter the key in your app instead.",
            // A-99 (HLD J-7), confirmed by the owner 2026-11-20.
            R.string.twostep_open_app to "Open in authenticator app",
        )
        for ((id, value) in expected) assertEquals(value, text(id))
    }
}
