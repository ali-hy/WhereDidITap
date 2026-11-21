// P-A-513 (6), P-A-516 (c), P-A-525: the window behind Compose and the status and navigation bars
// are the mode's `canvas` (guide §3.5, §15), so nothing flashes another colour before the first draw.
// TP-0b.9x (review B-6 (b)) and TP-0b.12 (A-34). IDs ending in "x" are test-architect additions, not
// LLD test-plan IDs. values{,-night}/colors.xml hold the hex by hand; this keeps it equal to the
// generated tokens.
package com.budmon.app.ui.theme

import android.content.Context
import android.graphics.drawable.ColorDrawable
import android.view.ContextThemeWrapper
import androidx.compose.ui.graphics.toArgb
import androidx.test.core.app.ApplicationProvider
import com.budmon.app.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class WindowBackgroundTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    /** The application theme's android:windowBackground, as a colour. */
    private fun windowBackground(): Int {
        assertNotEquals("the application has a theme", 0, context.applicationInfo.theme)
        val themed = ContextThemeWrapper(context, context.applicationInfo.theme)
        val attrs = themed.obtainStyledAttributes(intArrayOf(android.R.attr.windowBackground))
        try {
            val drawable = attrs.getDrawable(0)
            return (drawable as? ColorDrawable)?.color ?: error("windowBackground isn't a colour: $drawable")
        } finally {
            attrs.recycle()
        }
    }

    /** A colour attribute (such as android:statusBarColor) of the application theme from the manifest. */
    private fun themeColor(attr: Int, name: String): Int {
        assertNotEquals("the application has a theme", 0, context.applicationInfo.theme)
        val themed = ContextThemeWrapper(context, context.applicationInfo.theme)
        val attrs = themed.obtainStyledAttributes(intArrayOf(attr))
        try {
            assertTrue("the theme sets $name", attrs.hasValue(0))
            return attrs.getColor(0, 0)
        } finally {
            attrs.recycle()
        }
    }

    /** TP-0b.12: windowBackground, statusBarColor and navigationBarColor all equal `canvas`. */
    private fun assertWindowAndBarsAre(canvas: Int) {
        assertEquals("windowBackground", canvas, windowBackground())
        assertEquals("statusBarColor", canvas, themeColor(android.R.attr.statusBarColor, "android:statusBarColor"))
        assertEquals(
            "navigationBarColor",
            canvas,
            themeColor(android.R.attr.navigationBarColor, "android:navigationBarColor"),
        )
    }

    @Test
    fun `TP-0b_12 by day the window background, status bar and navigation bar are Tokens Teal Light canvas`() {
        assertWindowAndBarsAre(Tokens.Teal.Light.canvas.toArgb())
    }

    @Test
    @Config(qualifiers = "night")
    fun `TP-0b_12 at night the window background, status bar and navigation bar are Tokens Teal Dark canvas`() {
        assertWindowAndBarsAre(Tokens.Teal.Dark.canvas.toArgb())
    }

    @Test
    fun `TP-0b_9x by day the window background and window_canvas are Tokens Teal Light canvas`() {
        val canvas = Tokens.Teal.Light.canvas.toArgb()

        assertEquals(canvas, context.getColor(R.color.window_canvas))
        assertEquals(canvas, windowBackground())
    }

    @Test
    @Config(qualifiers = "night")
    fun `TP-0b_9x at night the window background and window_canvas are Tokens Teal Dark canvas`() {
        val canvas = Tokens.Teal.Dark.canvas.toArgb()

        assertEquals(canvas, context.getColor(R.color.window_canvas))
        assertEquals(canvas, windowBackground())
    }
}
