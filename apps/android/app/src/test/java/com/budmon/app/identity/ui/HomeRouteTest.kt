// F-209/F-216 HomeRoute's recovery-code notice (identity LLD §8.2, A-107, A-108, A-111; HLD J-5).
// TP-4.50 (c) and (g), plus TP-4.50x.
// The host mirrors MainActivity: recoveryLeft is notice.left's value, and onRecoveryNoticeDone is
// notice::consume, which A-111 runs when the snackbar ends (action, dismiss or the Long timeout),
// not when it shows. Texts are §8.1's, matched literally (twostep_recovery_left is a plurals
// resource); the dismiss button is Material's own ("Dismiss").
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.R
import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.core.outbox.OutboxRepository
import com.budmon.app.identity.AuthRepository
import com.budmon.app.identity.ME
import com.budmon.app.identity.RecoveryCodesNotice
import com.budmon.app.identity.SignOutViewModel
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class HomeRouteTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private fun text(id: Int) = context.getString(id)

    private val signOut =
        SignOutViewModel(mockk<AuthRepository>(relaxed = true), mockk<OutboxDao>(relaxed = true), mockk<OutboxRepository>(relaxed = true))

    private class Counter {
        var calls = 0
        val call: () -> Unit = { calls += 1 }
    }

    private val notice = RecoveryCodesNotice()
    private val done = Counter()
    private val createCodes = Counter()

    /** The host: HomeRoute fed by the notice, consuming it in onRecoveryNoticeDone (as MainActivity). */
    @Composable
    private fun Host() {
        AppTheme(ThemeSetting.LIGHT) {
            val recoveryLeft by notice.left.collectAsState()
            HomeRoute(
                me = ME,
                isOnline = true,
                viewModel = signOut,
                onSignedOut = {},
                recoveryLeft = recoveryLeft,
                onRecoveryNoticeDone = {
                    done.call()
                    notice.consume()
                },
                onCreateCodes = createCodes.call,
            )
        }
    }

    /** HomeRoute after a recovery sign-in that left [left] codes (null: no recovery code used). */
    private fun showHome(left: Int?) {
        if (left != null) notice.post(left)
        compose.setContent { Host() }
    }

    private fun message(n: Int) = if (n == 1) "You used a recovery code. 1 code left." else "You used a recovery code. $n codes left."

    private val createAction = hasText(text(R.string.twostep_create_new)) and hasClickAction()
    private val dismissAction = hasContentDescription("Dismiss") and hasClickAction()

    private fun count(matcher: SemanticsMatcher) = compose.onAllNodes(matcher).fetchSemanticsNodes().size

    @Test
    fun `TP-4_50 (c) HomeRoute with recoveryLeft 2 - the snackbar with Create new codes calling onCreateCodes, then onRecoveryNoticeDone once`() {
        showHome(2)
        compose.waitUntilAtLeastOneExists(hasText(message(2)), timeoutMillis = 5_000)
        assertEquals("not done while shown", 0, done.calls)

        compose.onNode(createAction).performClick()
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            done.calls > 0
        }

        assertEquals(1, createCodes.calls)
        assertEquals(1, done.calls)
        assertNull(notice.left.value)
    }

    @Test
    fun `TP-4_50 (c) HomeRoute with recoveryLeft 8 - the snackbar with no action, onRecoveryNoticeDone once after the Long timeout`() {
        showHome(8)
        compose.waitUntilAtLeastOneExists(hasText(message(8)), timeoutMillis = 5_000)
        assertEquals(0, count(createAction))
        assertEquals("not done while shown", 0, done.calls)

        compose.mainClock.advanceTimeBy(15_000)
        compose.waitForIdle()

        compose.onAllNodes(hasText(message(8))).assertCountEquals(0)
        assertEquals(1, done.calls)
        assertNull(notice.left.value)
    }

    @Test
    fun `TP-4_50 (g) HomeRoute with recoveryLeft 2 - not done while shown, shown again after recreation, then Dismiss - onRecoveryNoticeDone once`() {
        notice.post(2)
        val restoration = StateRestorationTester(compose)
        restoration.setContent { Host() }
        compose.waitUntilAtLeastOneExists(hasText(message(2)), timeoutMillis = 5_000)
        assertEquals(0, done.calls)

        restoration.emulateSavedInstanceStateRestore()
        compose.waitUntilAtLeastOneExists(hasText(message(2)), timeoutMillis = 5_000)

        compose.onAllNodes(hasText(message(2))).assertCountEquals(1)
        assertEquals(1, count(createAction))
        assertEquals("not done before the dismiss", 0, done.calls)
        assertNotNull(notice.left.value)

        compose.onNode(dismissAction).performClick()
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            done.calls > 0
        }

        assertEquals(1, done.calls)
        assertEquals(0, createCodes.calls)
        assertNull(notice.left.value)
        compose.onAllNodes(hasText(message(2))).assertCountEquals(0)
    }

    @Test
    fun `TP-4_50x HomeRoute with recoveryLeft 2 - Indefinite, still shown a minute later, not done`() {
        showHome(2)
        compose.waitUntilAtLeastOneExists(hasText(message(2)), timeoutMillis = 5_000)

        compose.mainClock.advanceTimeBy(60_000)
        compose.waitForIdle()

        compose.onAllNodes(hasText(message(2))).assertCountEquals(1)
        assertEquals(1, count(createAction))
        assertEquals(0, done.calls)
    }

    @Test
    fun `TP-4_50x HomeRoute with recoveryLeft 3 - the boundary, Create new codes shown`() {
        showHome(3)

        compose.waitUntilAtLeastOneExists(hasText(message(3)), timeoutMillis = 5_000)

        assertEquals(1, count(createAction))
    }

    @Test
    fun `TP-4_50x HomeRoute with recoveryLeft 4 - no action`() {
        showHome(4)

        compose.waitUntilAtLeastOneExists(hasText(message(4)), timeoutMillis = 5_000)

        assertEquals(0, count(createAction))
    }

    @Test
    fun `TP-4_50x HomeRoute with recoveryLeft 1 - the singular text with Create new codes`() {
        showHome(1)

        compose.waitUntilAtLeastOneExists(hasText(message(1)), timeoutMillis = 5_000)

        assertEquals(1, count(createAction))
    }

    @Test
    fun `TP-4_50x HomeRoute with recoveryLeft null - no snackbar, onRecoveryNoticeDone not called`() {
        showHome(null)
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        assertEquals(0, count(hasText("You used a recovery code.", substring = true)))
        assertEquals(0, done.calls)
    }
}
