// F-209/F-216 HomeRoute's recovery-code notice (identity LLD §8.2, A-107, A-108; HLD J-5). TP-4.50 (c)
// and (g), plus TP-4.50x.
// The host mirrors MainActivity: recoveryLeft is notice.left's value, and onRecoveryNoticeShown is
// notice::consume, which turns it to null as soon as the snackbar shows. Texts are §8.1's, matched
// literally (twostep_recovery_left is a plurals resource).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity.ui

import android.content.Context
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
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
    private val shown = Counter()
    private val createCodes = Counter()

    /** HomeRoute after a recovery sign-in that left [left] codes (null: no recovery code used). */
    private fun showHome(left: Int?) {
        if (left != null) notice.post(left)
        compose.setContent {
            AppTheme(ThemeSetting.LIGHT) {
                val recoveryLeft by notice.left.collectAsState()
                HomeRoute(
                    me = ME,
                    isOnline = true,
                    viewModel = signOut,
                    onSignedOut = {},
                    recoveryLeft = recoveryLeft,
                    onRecoveryNoticeShown = {
                        shown.call()
                        notice.consume()
                    },
                    onCreateCodes = createCodes.call,
                )
            }
        }
    }

    private fun message(n: Int) = if (n == 1) "You used a recovery code. 1 code left." else "You used a recovery code. $n codes left."

    private val createAction = hasText(text(R.string.twostep_create_new)) and hasClickAction()

    private fun count(matcher: SemanticsMatcher) = compose.onAllNodes(matcher).fetchSemanticsNodes().size

    @Test
    fun `TP-4_50 (c) HomeRoute with recoveryLeft 2 - the snackbar with Create new codes calling onCreateCodes, onRecoveryNoticeShown called`() {
        showHome(2)

        compose.waitUntilAtLeastOneExists(hasText(message(2)), timeoutMillis = 5_000)
        compose.waitUntil(5_000) { shown.calls > 0 }
        compose.onNode(createAction).performClick()

        assertEquals(1, createCodes.calls)
        assertEquals(1, shown.calls)
        assertNull(notice.left.value)
    }

    @Test
    fun `TP-4_50 (c) HomeRoute with recoveryLeft 8 - the snackbar with no action, onRecoveryNoticeShown called`() {
        showHome(8)

        compose.waitUntilAtLeastOneExists(hasText(message(8)), timeoutMillis = 5_000)
        compose.waitUntil(5_000) { shown.calls > 0 }

        assertEquals(0, count(createAction))
        assertEquals(1, shown.calls)
    }

    @Test
    fun `TP-4_50 (g) HomeRoute with recoveryLeft 2, the host setting it to null in onRecoveryNoticeShown - the snackbar with Create new codes still shown afterwards`() {
        showHome(2)
        compose.waitUntilAtLeastOneExists(hasText(message(2)), timeoutMillis = 5_000)
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            notice.left.value == null
        }

        // Indefinite: still there a minute after recoveryLeft turned null.
        compose.mainClock.advanceTimeBy(60_000)
        compose.waitForIdle()

        compose.onAllNodes(hasText(message(2))).assertCountEquals(1)
        assertEquals(1, count(createAction))
        assertEquals(1, shown.calls)
    }

    @Test
    fun `TP-4_50x HomeRoute with recoveryLeft 8 - Long, gone after 15 s`() {
        showHome(8)
        compose.waitUntilAtLeastOneExists(hasText(message(8)), timeoutMillis = 5_000)

        compose.mainClock.advanceTimeBy(15_000)
        compose.waitForIdle()

        compose.onAllNodes(hasText(message(8))).assertCountEquals(0)
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
    fun `TP-4_50x HomeRoute with recoveryLeft null - no snackbar, onRecoveryNoticeShown not called`() {
        showHome(null)
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        assertEquals(0, count(hasText("You used a recovery code.", substring = true)))
        assertEquals(0, shown.calls)
    }
}
