// P-A-523, identity A-33: the launcher icon is an adaptive icon, an accent tile with a white "D",
// with a monochrome layer for themed icons. TP-0b.10 (Android part), plus TP-0b.10x. IDs ending in
// "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.ui

import android.content.Context
import android.content.res.XmlResourceParser
import androidx.compose.ui.graphics.toArgb
import androidx.test.core.app.ApplicationProvider
import com.budmon.app.R
import com.budmon.app.ui.theme.Tokens
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.xmlpull.v1.XmlPullParser

private const val ANDROID_NS = "http://schemas.android.com/apk/res/android"

@RunWith(RobolectricTestRunner::class)
class LauncherIconTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    /** The root tag of ic_launcher.xml and its child layers' tag to android:drawable resource ID. */
    private fun launcherLayers(): Pair<String, Map<String, Int>> {
        val parser: XmlResourceParser = context.resources.getXml(R.mipmap.ic_launcher)
        try {
            var root = ""
            val layers = mutableMapOf<String, Int>()
            var event = parser.next()
            while (event != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG) {
                    if (parser.depth == 1) {
                        root = parser.name
                    } else if (parser.depth == 2) {
                        layers[parser.name] = parser.getAttributeResourceValue(ANDROID_NS, "drawable", 0)
                    }
                }
                event = parser.next()
            }
            return root to layers
        } finally {
            parser.close()
        }
    }

    @Test
    fun `TP-0b_10 ic_launcher is an adaptive icon with background, foreground and monochrome layers`() {
        val (root, layers) = launcherLayers()

        assertEquals("adaptive-icon", root)
        assertEquals(setOf("background", "foreground", "monochrome"), layers.keys)
        for ((name, drawable) in layers) {
            assertNotEquals("$name has an android:drawable", 0, drawable)
        }
    }

    @Test
    fun `TP-0b_10x the application's icon is the ic_launcher mipmap`() {
        assertEquals(R.mipmap.ic_launcher, context.applicationInfo.icon)
    }

    @Test
    fun `TP-0b_10x by day the background layer is the accent colour Tokens Teal Light accent`() {
        val background = launcherLayers().second.getValue("background")

        assertEquals("color", context.resources.getResourceTypeName(background))
        assertEquals(Tokens.Teal.Light.accent.toArgb(), context.getColor(background))
    }
}
