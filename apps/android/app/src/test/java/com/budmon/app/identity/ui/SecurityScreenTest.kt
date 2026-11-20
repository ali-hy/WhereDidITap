// F-214's S-4 entry point (identity LLD §8.2's S-4 signatures, A-100): HomeFirstRunScreen's account
// menu with Sign-in & security, and SecurityScreen's two-step section. TP-4.40, plus TP-4.40x.
// Screens get fake lambdas that count their calls. `me` is ME with Me's flat two-step fields
// (twoStepEnabled, codesAcknowledged; A-103 (2)).
// TP-4.50 (d), A-107: "N recovery codes left" under the status while two-step is on.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.R
import com.budmon.app.identity.ME
import com.budmon.app.identity.Me
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecurityScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private fun text(id: Int) = context.getString(id)

    private class Counter {
        var calls = 0
        val call: () -> Unit = { calls += 1 }
    }

    private fun show(content: @Composable () -> Unit) {
        compose.setContent { AppTheme(ThemeSetting.LIGHT) { content() } }
    }

    private val off = ME.copy(twoStepEnabled = false, recoveryCodesLeft = 0, codesAcknowledged = true)
    private val onUnsaved = ME.copy(twoStepEnabled = true, recoveryCodesLeft = 10, codesAcknowledged = false)
    private val onSaved = ME.copy(twoStepEnabled = true, recoveryCodesLeft = 10, codesAcknowledged = true)

    /** Scrolls the node into view when the screen scrolls (the LLD doesn't say whether it does). */
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

    private fun noButton(labelId: Int) = compose.onNode(hasText(text(labelId)) and hasClickAction()).assertDoesNotExist()

    private class Lambdas {
        val turnOn = Counter()
        val turnOff = Counter()
        val replace = Counter()
        val createCodes = Counter()
        fun calls() = listOf(turnOn.calls, turnOff.calls, replace.calls, createCodes.calls)
    }

    private fun showSecurity(me: Me, lambdas: Lambdas = Lambdas()) = show {
        SecurityScreen(
            me = me,
            onTurnOn = lambdas.turnOn.call,
            onTurnOff = lambdas.turnOff.call,
            onReplace = lambdas.replace.call,
            onCreateCodes = lambdas.createCodes.call,
        )
    }

    // ---- HomeFirstRunScreen's account menu ----

    @Test
    fun `TP-4_40 HomeFirstRunScreen account menu - Sign-in & security, then Sign out, the first calling onSecurity`() {
        val security = Counter()
        val signOut = Counter()
        show { HomeFirstRunScreen(me = ME, onSecurity = security.call, onSignOut = signOut.call) }

        compose.onNodeWithText(text(R.string.menu_security)).assertDoesNotExist()
        compose.onNodeWithContentDescription(text(R.string.menu_account)).assertIsDisplayed().performClick()
        val securityTop = compose.onNodeWithText(text(R.string.menu_security)).assertIsDisplayed().fetchSemanticsNode().boundsInRoot.top
        val signOutTop = compose.onNodeWithText(text(R.string.menu_sign_out)).assertIsDisplayed().fetchSemanticsNode().boundsInRoot.top
        assertTrue("Sign-in & security above Sign out", securityTop < signOutTop)

        compose.onNodeWithText(text(R.string.menu_security)).performClick()

        assertEquals(1, security.calls)
        assertEquals(0, signOut.calls)
    }

    // ---- SecurityScreen's two-step section ----

    @Test
    fun `TP-4_40 SecurityScreen with two-step off - the heading, Off and Turn on, none of the on actions`() {
        showSecurity(off)

        compose.onNodeWithText(text(R.string.twostep_title)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.twostep_status_off)).assertIsDisplayed()
        button(R.string.twostep_turn_on).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.twostep_status_on)).assertDoesNotExist()
        noButton(R.string.twostep_off)
        noButton(R.string.twostep_replace)
        noButton(R.string.twostep_create_new)
        compose.onNodeWithText(text(R.string.twostep_codes_unsaved)).assertDoesNotExist()
    }

    @Test
    fun `TP-4_40 SecurityScreen with two-step on, codes not acknowledged - On, Turn off, Replace authenticator app, Create new codes and the unsaved-codes banner`() {
        showSecurity(onUnsaved)

        compose.onNodeWithText(text(R.string.twostep_title)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.twostep_status_on)).assertIsDisplayed()
        button(R.string.twostep_off).assertIsDisplayed()
        button(R.string.twostep_replace).assertIsDisplayed()
        button(R.string.twostep_create_new).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.twostep_codes_unsaved)).inView().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.twostep_status_off)).assertDoesNotExist()
        noButton(R.string.twostep_turn_on)
    }

    @Test
    fun `TP-4_40x SecurityScreen with two-step on, codes acknowledged - no unsaved-codes banner`() {
        showSecurity(onSaved)

        compose.onNodeWithText(text(R.string.twostep_status_on)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.twostep_codes_unsaved)).assertDoesNotExist()
    }

    @Test
    fun `TP-4_40x SecurityScreen off - Turn on calls onTurnOn only`() {
        val lambdas = Lambdas()
        showSecurity(off, lambdas)

        button(R.string.twostep_turn_on).performClick()

        assertEquals(listOf(1, 0, 0, 0), lambdas.calls())
    }

    @Test
    fun `TP-4_40x SecurityScreen on - Turn off, Replace authenticator app and Create new codes each call their own lambda`() {
        val lambdas = Lambdas()
        showSecurity(onUnsaved, lambdas)

        button(R.string.twostep_off).performClick()
        assertEquals(listOf(0, 1, 0, 0), lambdas.calls())
        button(R.string.twostep_replace).performClick()
        assertEquals(listOf(0, 1, 1, 0), lambdas.calls())
        button(R.string.twostep_create_new).performClick()
        assertEquals(listOf(0, 1, 1, 1), lambdas.calls())
    }

    // ---- strings (§8.1's S-10 texts in snake case, §8.2; menu_security, A-100) ----

    @Test
    fun `TP-4_40x the S-4 Security strings have the texts of §8_1 and §8_2`() {
        val expected = mapOf<Int, String>(
            R.string.menu_security to "Sign-in & security",
            R.string.twostep_title to "Two-step verification",
            R.string.twostep_status_on to "On",
            R.string.twostep_status_off to "Off",
            R.string.twostep_turn_on to "Turn on",
            R.string.twostep_off to "Turn off",
            R.string.twostep_replace to "Replace authenticator app",
            R.string.twostep_create_new to "Create new codes",
            R.string.twostep_codes_unsaved to "You may not have saved your recovery codes.",
            R.string.twostep_off_confirm to "Turn off two-step verification? Your account will be protected by your password only.",
            R.string.twostep_off_done to "Two-step verification is off.",
            R.string.twostep_new_codes_done to "Your old codes no longer work.",
            R.string.twostep_codes_ack to "I've saved my recovery codes",
            R.string.twostep_codes_done to "Done",
        )
        for ((id, value) in expected) assertEquals(value, text(id))
    }

    // ---- TP-4.50 (d), A-107: recovery codes left (twostep_codes_left, plurals) ----

    private fun exists(text: String) = compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun `TP-4_50 (d) SecurityScreen with two-step on and 8 codes left - 8 recovery codes left`() {
        showSecurity(onSaved.copy(recoveryCodesLeft = 8))

        compose.onNode(hasText("8 recovery codes left")).inView().assertIsDisplayed()
    }

    @Test
    fun `TP-4_50x SecurityScreen with two-step on and 1 code left - 1 recovery code left (singular)`() {
        showSecurity(onSaved.copy(recoveryCodesLeft = 1))

        compose.onNode(hasText("1 recovery code left")).inView().assertIsDisplayed()
        assertTrue("no plural form", !exists("1 recovery codes left"))
    }

    @Test
    fun `TP-4_50x SecurityScreen with two-step off - no recovery codes left line`() {
        showSecurity(off)

        assertTrue(!exists("0 recovery codes left"))
        assertTrue(compose.onAllNodes(hasText("recovery codes left", substring = true)).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun `TP-4_50x SecurityScreen with two-step on, 8 codes left - the count below the status On`() {
        showSecurity(onSaved.copy(recoveryCodesLeft = 8))

        val statusBottom = compose.onNode(hasText(text(R.string.twostep_status_on))).fetchSemanticsNode().boundsInRoot.bottom
        val countTop = compose.onNode(hasText("8 recovery codes left")).fetchSemanticsNode().boundsInRoot.top
        assertTrue("the count is under the status line", countTop >= statusBottom)
    }
}
