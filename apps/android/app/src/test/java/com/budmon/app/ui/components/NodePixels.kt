// Test support: a node's pixels under Robolectric's native graphics.
// captureToImage() times out here: it waits for a redraw that Robolectric's paused looper never
// runs. Drawing the window's decor view into a bitmap on the UI thread gives the same pixels.
package com.budmon.app.ui.components

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.PixelMap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import kotlin.math.roundToInt

/** The pixels of [node]'s bounds in the window, at the device's density. */
internal fun AndroidComposeTestRule<*, ComponentActivity>.pixelsOf(node: SemanticsNodeInteraction): PixelMap {
    waitForIdle()
    val bounds = node.fetchSemanticsNode().boundsInWindow
    lateinit var window: Bitmap
    runOnUiThread {
        val root = activity.window.decorView
        window = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
        root.draw(Canvas(window))
    }
    val left = bounds.left.roundToInt()
    val top = bounds.top.roundToInt()
    val crop = Bitmap.createBitmap(window, left, top, bounds.width.roundToInt(), bounds.height.roundToInt())
    return crop.asImageBitmap().toPixelMap()
}
