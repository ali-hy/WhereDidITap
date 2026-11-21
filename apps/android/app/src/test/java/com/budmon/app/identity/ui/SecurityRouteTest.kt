// F-214 SecurityRoute and TurnOffTwoStepDialog (identity LLD §8.2's S-4 signatures, A-100, A-101).
// TP-4.42 rows (a) to (d), plus TP-4.42x. TP-4.48 (c) (A-106): the replacement's snackbar.
// TP-4.50x (A-107, QA Q-5): Back from the new codes shows the unsaved-codes banner at once;
// startNewCodes opens the codes once.
// Setup per TP-4.42: a Compose rule in a test activity (FLAG_SECURE is read from its window); a
// MockK AuthRepository; the real SecurityViewModel and ConfirmationCoordinator around it. The host
// keeps `me` in a mutableStateOf that onMeUpdated updates (P-A-534), as MainActivity's session does.
// The repository's getMe() answers `serverMe`, which twoStepDisable turns to two-step off.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity.ui

import android.content.Context
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.R
import com.budmon.app.core.error.UiText
import com.budmon.app.identity.AuthRepository
import com.budmon.app.identity.ConfirmationCoordinator
import com.budmon.app.identity.ME
import com.budmon.app.identity.Me
import com.budmon.app.identity.SecurityViewModel
import com.budmon.app.identity.TurnOffFormState
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class SecurityRouteTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private fun text(id: Int) = context.getString(id)

    private class Counter {
        var calls = 0
        var last: String? = null
        val call: () -> Unit = { calls += 1 }
        val text: (String) -> Unit = {
            calls += 1
            last = it
        }
    }

    private val meOn = ME.copy(twoStepEnabled = true, recoveryCodesLeft = 10, codesAcknowledged = true)
    private val meOff = ME.copy(twoStepEnabled = false, recoveryCodesLeft = 0, codesAcknowledged = true)
    private val codes = "ABCDEFGHJK".map { "7KQ2-M3XD-4TR$it" }

    /** What getMe() answers; twoStepDisable turns it to two-step off. */
    private var serverMe = meOn
    private val repository = mockk<AuthRepository> {
        coEvery { getMe() } answers { serverMe }
        coEvery { twoStepDisable(any(), any()) } answers { serverMe = meOff }
        coEvery { regenerateRecoveryCodes() } returns codes
        coEvery { acknowledgeRecoveryCodes() } just runs
    }

    /** Every me the route passed to onMeUpdated. */
    private val updates = mutableListOf<Me>()

    private fun secureFlagSet(): Boolean =
        compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    /** Shows SecurityRoute for [initial] (its host keeps `me` updated by onMeUpdated); returns the view model. */
    private fun showRoute(initial: Me = meOn, startNewCodes: Boolean = false): SecurityViewModel {
        val vm = SecurityViewModel(repository, ConfirmationCoordinator(repository))
        val me = mutableStateOf(initial)
        compose.setContent {
            AppTheme(ThemeSetting.LIGHT) {
                SecurityRoute(
                    me = me.value,
                    viewModel = vm,
                    onMeUpdated = {
                        updates += it
                        me.value = it
                    },
                    onTurnOn = {},
                    onReplace = {},
                    onBack = {},
                    startNewCodes = startNewCodes,
                )
            }
        }
        compose.waitForIdle()
        return vm
    }

    // ---- node helpers ----

    private val inDialog = hasAnyAncestor(isDialog())

    /** Scrolls the node into view when its screen scrolls (the LLD doesn't say whether it does). */
    private fun SemanticsNodeInteraction.inView(): SemanticsNodeInteraction {
        var parent = fetchSemanticsNode().parent
        while (parent != null) {
            if (parent.config.contains(SemanticsActions.ScrollBy)) return performScrollTo()
            parent = parent.parent
        }
        return this
    }

    private fun sectionButton(labelId: Int) = compose.onNode(hasText(text(labelId)) and hasClickAction() and !inDialog)

    private fun dialogButton(labelId: Int) = compose.onNode(hasText(text(labelId)) and hasClickAction() and inDialog)

    /** The dialog's editable field labelled [labelId] (P-A-524's AppTextField content description). */
    private fun dialogField(labelId: Int) =
        compose.onNode(hasContentDescription(text(labelId)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText) and inDialog)

    private fun code(c: String) = hasText(c, substring = true)

    private fun dialogRoot() = (compose.onNode(isDialog()).fetchSemanticsNode().root as ViewRootForTest).view.rootView

    /** Back to the dialog's window, as a real key press does. */
    private fun backOnDialog() {
        val root = dialogRoot()
        compose.runOnUiThread {
            root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK))
            root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK))
        }
        compose.waitForIdle()
    }

    /** A tap outside the dialog's window (negative window coordinates), as a real tap outside it is. */
    private fun tapOutsideDialog() {
        val root = dialogRoot()
        compose.runOnUiThread {
            val t = SystemClock.uptimeMillis()
            for (action in intArrayOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                val event = MotionEvent.obtain(t, t, action, -40f, -40f, 0)
                root.dispatchTouchEvent(event)
                event.recycle()
            }
        }
        compose.waitForIdle()
    }

    /** System back, through the activity's dispatcher (the route's BackHandler). */
    private fun systemBack() {
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    /** Taps Create new codes and waits for the regenerated codes. */
    private fun createNewCodes() {
        sectionButton(R.string.twostep_create_new).inView().performClick()
        compose.waitUntilAtLeastOneExists(code(codes[0]), timeoutMillis = 5_000)
    }

    private fun assertSectionShown() {
        compose.waitUntilAtLeastOneExists(hasText(text(R.string.twostep_create_new)) and hasClickAction(), timeoutMillis = 5_000)
        compose.onAllNodes(code(codes[0])).assertCountEquals(0)
    }

    // ---- (a) Turn off ----

    @Test
    fun `TP-4_42 (a) Turn off - the J-7 dialog, code field focused, Turn off and Cancel, then the snackbar Two-step verification is off`() {
        showRoute()

        sectionButton(R.string.twostep_off).inView().performClick()
        compose.waitForIdle()

        compose.onNode(hasText(text(R.string.twostep_off_confirm)) and inDialog).assertIsDisplayed()
        dialogField(R.string.twostep_code).assertIsFocused()
        dialogButton(R.string.twostep_off).assertIsDisplayed()
        dialogButton(R.string.confirm_cancel).assertIsDisplayed()

        dialogField(R.string.twostep_code).performTextInput("123456")
        dialogButton(R.string.twostep_off).performClick()
        compose.waitUntilAtLeastOneExists(hasText(text(R.string.twostep_off_done)), timeoutMillis = 5_000)

        coVerify(exactly = 1) { repository.twoStepDisable("123456", null) }
        compose.onNode(isDialog()).assertDoesNotExist()
    }

    @Test
    fun `TP-4_42x after turning off - the section shows Off and Turn on (refreshed through onMeUpdated)`() {
        showRoute()
        sectionButton(R.string.twostep_off).inView().performClick()
        compose.waitForIdle()
        dialogField(R.string.twostep_code).performTextInput("123456")
        dialogButton(R.string.twostep_off).performClick()

        compose.waitUntilAtLeastOneExists(hasText(text(R.string.twostep_turn_on)) and hasClickAction(), timeoutMillis = 5_000)
        compose.onNodeWithText(text(R.string.twostep_status_off)).assertExists()
        assertEquals(meOff, updates.last())
    }

    @Test
    fun `TP-4_42x Cancel in the turn-off dialog - the dialog closes, no request`() {
        showRoute()
        sectionButton(R.string.twostep_off).inView().performClick()
        compose.waitForIdle()

        dialogButton(R.string.confirm_cancel).performClick()
        compose.waitForIdle()

        compose.onNode(isDialog()).assertDoesNotExist()
        coVerify(exactly = 0) { repository.twoStepDisable(any(), any()) }
    }

    @Test
    fun `TP-4_42x the route refreshes me on show - getMe once, onMeUpdated(me), the section follows it`() {
        serverMe = meOff
        showRoute(initial = meOn)

        compose.waitUntilAtLeastOneExists(hasText(text(R.string.twostep_turn_on)) and hasClickAction(), timeoutMillis = 5_000)
        coVerify(exactly = 1) { repository.getMe() }
        assertEquals(listOf(meOff), updates)
    }

    // ---- (b), (c) Create new codes ----

    @Test
    fun `TP-4_42 (b) Create new codes - the ten codes below Your old codes no longer work, FLAG_SECURE set, then back - the section, FLAG_SECURE cleared, no acknowledge`() {
        showRoute()
        assertFalse("no FLAG_SECURE on the section", secureFlagSet())

        createNewCodes()

        for (c in codes) compose.onAllNodes(code(c)).onFirst().assertExists()
        val doneTop = compose.onNodeWithText(text(R.string.twostep_new_codes_done)).fetchSemanticsNode().boundsInRoot.top
        val firstCodeTop = compose.onAllNodes(code(codes[0])).onFirst().fetchSemanticsNode().boundsInRoot.top
        assertTrue("Your old codes no longer work. is above the codes", doneTop < firstCodeTop)
        compose.onNode(isDialog()).assertDoesNotExist()
        assertTrue("FLAG_SECURE while the codes show", secureFlagSet())

        systemBack()

        assertSectionShown()
        assertFalse("FLAG_SECURE cleared", secureFlagSet())
        coVerify(exactly = 0) { repository.acknowledgeRecoveryCodes() }
    }

    @Test
    fun `TP-4_42 (c) Create new codes, tick and Done - acknowledgeRecoveryCodes once, the section, FLAG_SECURE cleared`() {
        showRoute()
        createNewCodes()

        compose.onNode(hasText(text(R.string.twostep_codes_ack)) and isToggleable()).inView().performClick()
        compose.onNode(hasText(text(R.string.twostep_codes_done)) and hasClickAction()).inView().performClick()

        assertSectionShown()
        coVerify(exactly = 1) { repository.acknowledgeRecoveryCodes() }
        assertFalse("FLAG_SECURE cleared", secureFlagSet())
    }

    @Test
    fun `TP-4_42x Done before ticking - no acknowledge call, the codes stay`() {
        showRoute()
        createNewCodes()

        compose.onNode(hasText(text(R.string.twostep_codes_done)) and hasClickAction()).inView().performClick()
        compose.waitForIdle()

        coVerify(exactly = 0) { repository.acknowledgeRecoveryCodes() }
        compose.onAllNodes(code(codes[0])).onFirst().assertExists()
        assertTrue(secureFlagSet())
    }

    // ---- (d) TurnOffTwoStepDialog ----

    private fun showDialog(
        form: TurnOffFormState,
        confirm: Counter = Counter(),
        dismiss: Counter = Counter(),
        toggle: Counter = Counter(),
        values: Counter = Counter(),
    ) {
        val state = mutableStateOf(form)
        compose.setContent {
            AppTheme(ThemeSetting.LIGHT) {
                TurnOffTwoStepDialog(
                    form = state.value,
                    onValueChange = {
                        values.text(it)
                        state.value = state.value.copy(value = it)
                    },
                    onToggleRecovery = {
                        toggle.call()
                        state.value = state.value.copy(useRecovery = !state.value.useRecovery, value = "")
                    },
                    onConfirm = confirm.call,
                    onDismiss = dismiss.call,
                )
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `TP-4_42 (d) the turn-off dialog while busy - Turn off and Cancel disabled, a tap outside doesn't dismiss`() {
        val confirm = Counter()
        val dismiss = Counter()
        showDialog(TurnOffFormState(value = "123456", busy = true), confirm = confirm, dismiss = dismiss)

        dialogButton(R.string.twostep_off).assertIsNotEnabled()
        dialogButton(R.string.confirm_cancel).assertIsNotEnabled()
        tapOutsideDialog()

        assertEquals(0, dismiss.calls)
        assertEquals(0, confirm.calls)
        compose.onNode(hasText(text(R.string.twostep_off_confirm)) and inDialog).assertIsDisplayed()
    }

    @Test
    fun `TP-4_42x the turn-off dialog while busy - Back doesn't dismiss`() {
        val dismiss = Counter()
        showDialog(TurnOffFormState(value = "123456", busy = true), dismiss = dismiss)

        backOnDialog()

        assertEquals(0, dismiss.calls)
    }

    @Test
    fun `TP-4_42x the turn-off dialog idle - a tap outside calls onDismiss (the tap reaches the dialog)`() {
        val dismiss = Counter()
        showDialog(TurnOffFormState(), dismiss = dismiss)

        tapOutsideDialog()

        assertTrue("onDismiss called", dismiss.calls >= 1)
    }

    @Test
    fun `TP-4_42x the turn-off dialog idle - Back calls onDismiss once`() {
        val dismiss = Counter()
        val confirm = Counter()
        showDialog(TurnOffFormState(), confirm = confirm, dismiss = dismiss)

        backOnDialog()

        assertEquals(1, dismiss.calls)
        assertEquals(0, confirm.calls)
    }

    @Test
    fun `TP-4_42x the turn-off dialog - typing calls onValueChange, Turn off calls onConfirm, Cancel calls onDismiss`() {
        val confirm = Counter()
        val dismiss = Counter()
        val values = Counter()
        showDialog(TurnOffFormState(), confirm = confirm, dismiss = dismiss, values = values)

        dialogField(R.string.twostep_code).performTextInput("1")
        dialogButton(R.string.twostep_off).performClick()
        assertEquals("1", values.last)
        assertEquals(listOf(1, 0), listOf(confirm.calls, dismiss.calls))
        dialogButton(R.string.confirm_cancel).performClick()
        assertEquals(listOf(1, 1), listOf(confirm.calls, dismiss.calls))
    }

    @Test
    fun `TP-4_42x the turn-off dialog - Use a recovery code instead calls onToggleRecovery, then the Recovery code field and Use a code from your app`() {
        val toggle = Counter()
        showDialog(TurnOffFormState(), toggle = toggle)

        dialogButton(R.string.twostep_use_recovery).performClick()
        compose.waitForIdle()

        assertEquals(1, toggle.calls)
        dialogField(R.string.twostep_recovery).assertExists()
        dialogButton(R.string.twostep_use_code).assertIsDisplayed()
    }

    @Test
    fun `TP-4_42x the turn-off dialog - the field's error, formError and twostep_limit_recovery when showRecoveryHint`() {
        val limited = UiText(R.plurals.error_rate_limited, listOf(2), quantity = 2)
        showDialog(TurnOffFormState(error = R.string.twostep_code_wrong, formError = limited, showRecoveryHint = true))

        compose.onNode(hasText(text(R.string.twostep_code_wrong)) and inDialog).assertExists()
        compose.onNode(hasText(context.resources.getQuantityString(R.plurals.error_rate_limited, 2, 2)) and inDialog).assertExists()
        compose.onNode(hasText(text(R.string.twostep_limit_recovery)) and inDialog).assertExists()
    }

    @Test
    fun `TP-4_42x the turn-off dialog without showRecoveryHint - no twostep_limit_recovery`() {
        showDialog(TurnOffFormState(formError = UiText(R.string.error_unavailable)))

        compose.onNode(hasText(text(R.string.error_unavailable)) and inDialog).assertExists()
        compose.onNode(hasText(text(R.string.twostep_limit_recovery))).assertDoesNotExist()
    }

    // ---- TP-4.48 (c), A-106: the replacement's snackbar ----

    private val replacedText = "Your authenticator app was replaced."

    @Test
    fun `TP-4_48 (c) SecurityRoute after showReplaced - the snackbar Your authenticator app was replaced once, then message null`() {
        val vm = showRoute()

        compose.runOnIdle { vm.showReplaced() }
        compose.waitUntilAtLeastOneExists(hasText(replacedText), timeoutMillis = 5_000)
        compose.onAllNodes(hasText(replacedText)).assertCountEquals(1)

        // The snackbar's own timeout, then messageShown().
        compose.mainClock.advanceTimeBy(15_000)
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            vm.state.message == null
        }
        compose.waitUntilDoesNotExist(hasText(replacedText), timeoutMillis = 5_000)

        // Not shown a second time.
        compose.mainClock.advanceTimeBy(15_000)
        compose.waitForIdle()
        compose.onAllNodes(hasText(replacedText)).assertCountEquals(0)
        assertEquals(null, vm.state.message)
    }

    // ---- TP-4.50x, A-107: the banner after Back (QA Q-5), startNewCodes ----

    @Test
    fun `TP-4_50x (Q-5) Create new codes, then Back without Done - You may not have saved your recovery codes shows at once, no reopen`() {
        // Regenerating leaves the new codes unacknowledged on the server.
        coEvery { repository.regenerateRecoveryCodes() } answers {
            serverMe = serverMe.copy(codesAcknowledged = false)
            codes
        }
        showRoute()
        compose.onAllNodes(hasText(text(R.string.twostep_codes_unsaved))).assertCountEquals(0)
        createNewCodes()

        systemBack()

        assertSectionShown()
        compose.waitUntilAtLeastOneExists(hasText(text(R.string.twostep_codes_unsaved)), timeoutMillis = 5_000)
        assertEquals(false, updates.last().codesAcknowledged)
        coVerify(exactly = 0) { repository.acknowledgeRecoveryCodes() }
    }

    @Test
    fun `TP-4_50x startNewCodes true - the regenerated codes without a tap, regenerateRecoveryCodes once`() {
        showRoute(startNewCodes = true)

        compose.waitUntilAtLeastOneExists(code(codes[0]), timeoutMillis = 5_000)
        compose.waitForIdle()

        coVerify(exactly = 1) { repository.regenerateRecoveryCodes() }
    }

    @Test
    fun `TP-4_50x startNewCodes true, then Back - the section, not the codes again`() {
        showRoute(startNewCodes = true)
        compose.waitUntilAtLeastOneExists(code(codes[0]), timeoutMillis = 5_000)

        systemBack()

        assertSectionShown()
        coVerify(exactly = 1) { repository.regenerateRecoveryCodes() }
    }
}
