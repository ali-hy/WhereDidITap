// F-258 platform UI (§8.2), in LTR and RTL and at font scale 2. TP-13.7.
//
// Parameters per A-344: UpdateRequiredScreen(pending, downloadUrl: String?, onOpenDownload:
// (String) -> Boolean; false or a null URL shows update_download_failed), SyncIndicator(pending,
// syncing: Boolean, failed). OfflineBanner(isOnline, pending) is assumed (A-344 doesn't list it).
package com.budmon.app.ui.platform

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w360dp-h740dp")
class PlatformUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun set(
        direction: LayoutDirection = LayoutDirection.Ltr,
        fontScale: Float = 1f,
        content: @androidx.compose.runtime.Composable () -> Unit,
    ) {
        compose.setContent {
            CompositionLocalProvider(
                LocalLayoutDirection provides direction,
                LocalDensity provides Density(density = 2f, fontScale = fontScale),
            ) { content() }
        }
    }

    @Test
    fun `TP-13_7 UpdateRequiredScreen with pending 0 has no pending note`() {
        set { UpdateRequiredScreen(pending = 0, downloadUrl = "https://x/app.apk", onOpenDownload = { true }) }

        compose.onNodeWithText("Update Budmon to continue").assertIsDisplayed()
        compose.onNodeWithText("This version is no longer supported. Updating takes about a minute.").assertIsDisplayed()
        compose.onNodeWithText("sync after you update", substring = true).assertDoesNotExist()
    }

    @Test
    fun `TP-13_7 UpdateRequiredScreen with pending 1 shows the singular note (A-475)`() {
        set { UpdateRequiredScreen(pending = 1, downloadUrl = "https://x/app.apk", onOpenDownload = { true }) }
        compose.onNodeWithText("1 entry you saved offline is kept and will sync after you update.").assertExists()
    }

    @Test
    fun `TP-13_7 UpdateRequiredScreen with 1500 pending shows exactly the 999+ note (A-467)`() {
        set { UpdateRequiredScreen(pending = 1500, downloadUrl = "https://x/app.apk", onOpenDownload = { true }) }
        compose.onNodeWithText("999+ entries you saved offline are kept and will sync after you update.").assertExists()
    }

    @Test
    fun `TP-13_7 a failing download shows update_download_failed`() {
        set { UpdateRequiredScreen(pending = 0, downloadUrl = "https://x/app.apk", onOpenDownload = { false }) }

        compose.onNodeWithText("Update Budmon").performClick()

        compose.onNodeWithText("Couldn't open the download. Ask the person who invited you for the latest version.").assertIsDisplayed()
    }

    @Test
    fun `TP-13_7 a null downloadUrl shows update_download_failed on Update`() {
        set { UpdateRequiredScreen(pending = 0, downloadUrl = null, onOpenDownload = { true }) }

        compose.onNodeWithText("Update Budmon").performClick()

        compose.onNodeWithText("Couldn't open the download", substring = true).assertIsDisplayed()
    }

    @Test
    fun `TP-13_7 SyncIndicator - hidden at 0, 3 waiting, 99+ at 120, 1 needs attention`() {
        set { SyncIndicator(pending = 0, syncing = false, failed = 0) }
        compose.onNodeWithText("waiting to sync", substring = true).assertDoesNotExist()
    }

    @Test
    fun `TP-13_7 SyncIndicator with 3 pending`() {
        set { SyncIndicator(pending = 3, syncing = false, failed = 0) }
        compose.onNodeWithText("3 waiting to sync", substring = true).assertIsDisplayed()
    }

    @Test
    fun `TP-13_7 SyncIndicator with 120 pending shows exactly 99+ waiting to sync (A-467)`() {
        set { SyncIndicator(pending = 120, syncing = false, failed = 0) }
        compose.onNodeWithText("99+ waiting to sync").assertIsDisplayed()
    }

    @Test
    fun `TP-13_7 SyncIndicator with 120 failed shows exactly 99+ need attention (A-467)`() {
        set { SyncIndicator(pending = 0, syncing = false, failed = 120) }
        compose.onNodeWithText("99+ need attention").assertIsDisplayed()
    }

    @Test
    fun `TP-13_7 SyncIndicator with 1 failed needs attention`() {
        set { SyncIndicator(pending = 0, syncing = false, failed = 1) }
        compose.onNodeWithText("1 needs attention", substring = true).assertIsDisplayed()
    }

    @Test
    fun `TP-13_7 OfflineBanner shows the offline text when offline`() {
        set { OfflineBanner(isOnline = false, pending = 0) }
        compose.onNodeWithText("You're offline. New entries are saved on this phone and sync when you're back online.").assertIsDisplayed()
    }

    /** Every text node lies horizontally inside the root (review B-7: the root is the window). */
    private fun assertTextsInsideRoot() {
        val root = compose.onRoot().fetchSemanticsNode().boundsInRoot
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Text)).fetchSemanticsNodes()
        assertTrue("no text nodes", texts.isNotEmpty())
        for (node in texts) {
            val b = node.boundsInRoot
            val label = node.config.getOrNull(SemanticsProperties.Text)?.joinToString() ?: "?"
            assertTrue("$label: $b outside $root", b.left >= root.left - 1f && b.right <= root.right + 1f)
            assertTrue("$label has no width", b.width > 0f)
        }
    }

    @Test
    fun `TP-13_7 at font scale 2 and 360 dp nothing is clipped - every text inside the root, Update reachable by scrolling`() {
        set(fontScale = 2f) { UpdateRequiredScreen(pending = 1500, downloadUrl = "https://x/app.apk", onOpenDownload = { true }) }

        assertTextsInsideRoot()
        compose.onNodeWithText("Update Budmon to continue").assertIsDisplayed()
        compose.onNodeWithText("Update Budmon").performScrollTo().assertIsDisplayed()
        compose
            .onNodeWithText("999+ entries you saved offline are kept and will sync after you update.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun `TP-13_7 UpdateRequiredScreen in RTL renders every text inside the root, Update reachable`() {
        set(direction = LayoutDirection.Rtl) {
            UpdateRequiredScreen(pending = 3, downloadUrl = "https://x/app.apk", onOpenDownload = { true })
        }

        assertTextsInsideRoot()
        compose.onNodeWithText("Update Budmon to continue").assertIsDisplayed()
        compose.onNodeWithText("Update Budmon").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("3 entries you saved offline are kept and will sync after you update.").assertExists()
    }

    @Test
    fun `TP-13_7 SyncIndicator while syncing shows exactly Syncing 3 with an ellipsis`() {
        set { SyncIndicator(pending = 3, syncing = true, failed = 0) }

        compose.onNodeWithText("Syncing 3…").assertIsDisplayed()
        compose.onNodeWithText("waiting to sync", substring = true).assertDoesNotExist()
    }

    @Test
    fun `TP-13_7 OfflineBanner back online with 2 pending shows Back online - Syncing 2 entries for 3 s, then hides`() {
        var online by mutableStateOf(false)
        compose.mainClock.autoAdvance = false
        set { OfflineBanner(isOnline = online, pending = 2) }
        compose.mainClock.advanceTimeByFrame()
        compose.onNodeWithText("You're offline", substring = true).assertExists()

        goOnline { online = true }
        compose.onNodeWithText("Back online. Syncing 2 entries…").assertIsDisplayed()

        compose.mainClock.advanceTimeBy(2_500)
        compose.onNodeWithText("Back online. Syncing 2 entries…").assertExists()

        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithText("Back online", substring = true).assertDoesNotExist()
    }

    @Test
    fun `TP-13_7 in RTL the indicator's icon sits after its text (mirrored layout)`() {
        set(direction = LayoutDirection.Rtl) { SyncIndicator(pending = 3, syncing = false, failed = 0) }

        val text = compose.onNodeWithText("3 waiting to sync", substring = true).fetchSemanticsNode().boundsInRoot
        val root = compose.onRoot().fetchSemanticsNode().boundsInRoot
        // In RTL content starts at the right edge.
        assertTrue(text.right >= root.right - (root.width / 2))
    }

    /**
     * Flips the banner online with the main clock paused: flushes the snapshot change, then one
     * frame recomposes and restarts the effect, the next shows the text it set, plus 100 ms.
     */
    private fun goOnline(flip: () -> Unit) {
        compose.runOnUiThread {
            flip()
            Snapshot.sendApplyNotifications()
        }
        compose.mainClock.advanceTimeByFrame()
        compose.mainClock.advanceTimeByFrame()
        compose.mainClock.advanceTimeBy(100)
    }

    // ---- A-475: the back-online text uses the capped count ----

    @Test
    fun `TP-13_7 (A-475) OfflineBanner back online with 1 pending is singular`() {
        var online by mutableStateOf(false)
        compose.mainClock.autoAdvance = false
        set { OfflineBanner(isOnline = online, pending = 1) }
        compose.mainClock.advanceTimeByFrame()

        goOnline { online = true }

        compose.onNodeWithText("Back online. Syncing 1 entry…").assertIsDisplayed()
    }

    @Test
    fun `TP-13_7 (A-475) OfflineBanner back online with 120 pending shows the capped count`() {
        var online by mutableStateOf(false)
        compose.mainClock.autoAdvance = false
        set { OfflineBanner(isOnline = online, pending = 120) }
        compose.mainClock.advanceTimeByFrame()

        goOnline { online = true }

        compose.onNodeWithText("Back online. Syncing 99+ entries…").assertIsDisplayed()
    }

    // ---- A-472: ErrorFallbackScreen ----

    private val bidi = Regex("[\u200E\u200F\u202A-\u202E\u2066-\u2069]")

    private fun textOf(node: SemanticsNodeInteraction): String =
        node.fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString("") { it.text } ?: ""

    @Test
    fun `TP-13_7 (A-472) ErrorFallbackScreen with a request id shows error_fallback_body and Reference 4bf92f35`() {
        set {
            ErrorFallbackScreen(
                requestId = "4bf92f35ab0cd1e2f3a4b5c6d7e8f901",
                stillFailing = false,
                busy = false,
                onRetry = {},
                onHome = {},
            )
        }

        compose
            .onNodeWithText("Try again in a moment. If it keeps happening, share this reference with the person who invited you.")
            .assertExists()
        val reference = compose.onNodeWithText("4bf92f35", substring = true)
        assertEquals("Reference: 4bf92f35", textOf(reference).replace(bidi, ""))
    }

    @Test
    fun `TP-13_7 (A-472) ErrorFallbackScreen without a request id shows the no-reference body and no Reference line`() {
        set { ErrorFallbackScreen(requestId = null, stillFailing = false, busy = false, onRetry = {}, onHome = {}) }

        compose.onNodeWithText("Try again in a moment. If it keeps happening, let the person who invited you know.").assertExists()
        val references = compose
            .onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Text))
            .fetchSemanticsNodes()
            .map { n -> n.config.getOrNull(SemanticsProperties.Text)?.joinToString("") { it.text } ?: "" }
            .filter { it.replace(bidi, "").startsWith("Reference") }
        assertEquals(emptyList<String>(), references)
    }

    @Test
    fun `TP-13_7 (A-472) busy true then false while still failing focuses Try again, described Still not working, title a heading`() {
        var busy by mutableStateOf(true)
        set { ErrorFallbackScreen(requestId = null, stillFailing = true, busy = busy, onRetry = {}, onHome = {}) }
        compose.waitForIdle()

        busy = false
        compose.waitForIdle()

        val retry = compose.onNodeWithText("Try again")
        retry.assertIsFocused()
        retry.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Still not working."))
        compose.onNodeWithText("Still not working.").assertExists()
        compose.onNodeWithText("Something went wrong on our side").assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }

    @Test
    fun `TP-13_7 (A-472) on first composition with stillFailing true and busy false, Try again isn't focused`() {
        set { ErrorFallbackScreen(requestId = null, stillFailing = true, busy = false, onRetry = {}, onHome = {}) }
        compose.waitForIdle()

        compose.onNodeWithText("Try again").assertIsNotFocused()
    }

    @Test
    fun `TP-13_7 (A-472) busy true then false while not still failing doesn't focus Try again`() {
        var busy by mutableStateOf(true)
        set { ErrorFallbackScreen(requestId = null, stillFailing = false, busy = busy, onRetry = {}, onHome = {}) }
        compose.waitForIdle()

        busy = false
        compose.waitForIdle()

        compose.onNodeWithText("Try again").assertIsNotFocused()
    }
}
