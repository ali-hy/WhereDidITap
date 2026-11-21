// P-A-513 (7), identity A-26: Android's visible name is "wDit". TP-0b.10x (Android). IDs ending in
// "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.ui

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.budmon.app.R
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class BrandStringsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `TP-0b_10x app_name, the launcher label, is wDit`() {
        assertEquals("wDit", context.getString(R.string.app_name))
    }

    @Test
    fun `TP-0b_10x the platform strings that name the product use wDit`() {
        assertEquals("Update wDit to continue", context.getString(R.string.update_required_title))
        assertEquals("Update wDit", context.getString(R.string.update_required_button))
        assertEquals("A new version of wDit is available.", context.getString(R.string.update_available))
        assertEquals(
            "wDit is temporarily unavailable. Try again in a few minutes.",
            context.getString(R.string.error_unavailable),
        )
    }
}
