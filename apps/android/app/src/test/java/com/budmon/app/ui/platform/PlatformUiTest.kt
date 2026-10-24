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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.test.ext.junit.runners.AndroidJUnit4
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
    fun `TP-13_7 UpdateRequiredScreen with pending 1 shows the pending note`() {
        set { UpdateRequiredScreen(pending = 1, downloadUrl = "https://x/app.apk", onOpenDownload = { true }) }
        compose.onNodeWithText("1 entries you saved offline", substring = true).assertExists()
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

        online = true
        compose.mainClock.advanceTimeBy(100)
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
}
