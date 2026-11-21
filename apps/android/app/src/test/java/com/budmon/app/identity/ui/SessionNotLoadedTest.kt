// SessionNotLoaded (identity LLD §8.2, F-207, A-37; P-A-528's busy rule). TP-3.49 row (j).
// Signature per A-37: SessionNotLoaded(isOnline, lastError, retrying, onRetry, modifier).
package com.budmon.app.identity.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.R
import com.budmon.app.core.network.ApiError
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SessionNotLoadedTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private fun text(id: Int) = context.getString(id)
    private var retries = 0

    private fun show(isOnline: Boolean, lastError: ApiError?, retrying: Boolean = false) {
        compose.setContent {
            Themed {
                SessionNotLoaded(
                    isOnline = isOnline,
                    lastError = lastError,
                    retrying = retrying,
                    onRetry = { retries += 1 },
                )
            }
        }
    }

    @Composable
    private fun Themed(content: @Composable () -> Unit) = AppTheme(ThemeSetting.LIGHT) { content() }

    private fun retryButton() = compose.onNodeWithText(text(R.string.error_fallback_retry))

    @Test
    fun `TP-3_49 (j) offline with Network - offline_nothing_loaded and Try again, which calls onRetry`() {
        show(isOnline = false, lastError = ApiError.Network)

        compose.onNodeWithText(text(R.string.offline_nothing_loaded)).assertIsDisplayed()
        retryButton().assertIsDisplayed().performClick()
        assertEquals(1, retries)
    }

    @Test
    fun `TP-3_49 (j) online with Network - error_unavailable`() {
        show(isOnline = true, lastError = ApiError.Network)

        compose.onNodeWithText(text(R.string.error_unavailable)).assertIsDisplayed()
        retryButton().assertIsDisplayed()
    }

    @Test
    fun `TP-3_49 (j) online with Timeout - error_unavailable, not error_generic_read`() {
        show(isOnline = true, lastError = ApiError.Timeout)

        compose.onNodeWithText(text(R.string.error_unavailable)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.error_generic_read)).assertDoesNotExist()
        retryButton().assertIsDisplayed().performClick()
        assertEquals(1, retries)
    }

    @Test
    fun `TP-3_49 (j) online with Defined INTERNAL - error_generic_read`() {
        show(isOnline = true, lastError = ApiError.Defined("INTERNAL", 500, null))

        compose.onNodeWithText(text(R.string.error_generic_read)).assertIsDisplayed()
        retryButton().assertIsDisplayed()
    }

    @Test
    fun `TP-3_49 (j) retrying - progress shown, Try again still enabled, and a tap doesn't call onRetry`() {
        show(isOnline = true, lastError = ApiError.Network, retrying = true)

        compose.onNode(
            SemanticsMatcher.expectValue(
                SemanticsProperties.ProgressBarRangeInfo,
                ProgressBarRangeInfo.Indeterminate,
            ),
            useUnmergedTree = true,
        ).assertExists()
        retryButton().assertIsEnabled().performClick()
        assertEquals(0, retries)
    }

    @Test
    fun `TP-3_49x a null lastError online reads as Unavailable - error_unavailable`() {
        show(isOnline = true, lastError = null)

        compose.onNodeWithText(text(R.string.error_unavailable)).assertIsDisplayed()
    }
}
