// P-A-513 (6), P-A-516 (c): the window behind Compose is the mode's `canvas` (guide §3.5, §15), so no
// white frame shows before the first draw. TP-0b.9x (review B-6 (b)). IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs. values{,-night}/colors.xml hold the hex by hand;
// this keeps it equal to the generated tokens.
package com.budmon.app.ui.theme

import android.content.Context
import android.graphics.drawable.ColorDrawable
import android.view.ContextThemeWrapper
import androidx.compose.ui.graphics.toArgb
import androidx.test.core.app.ApplicationProvider
import com.budmon.app.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
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
