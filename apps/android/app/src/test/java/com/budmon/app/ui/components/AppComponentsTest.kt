// P-A-524, P-A-528 Android shared components (identity A-31, A-37). TP-1.41, plus TP-1.41x.
// Signatures per P-A-528: AppButton(text, onClick, modifier, variant, enabled, busy, icon),
// AppTextField(value, onValueChange, label, modifier, hint, error, …), AppPasswordField(value,
// onValueChange, label, modifier, hint, error, …), Wordmark(modifier).
// Shape and colours by pixel sampling under native graphics at xxhdpi (3 px per dp): each component
// is tagged "c" inside a Box filled with the mode's canvas and padded 8 dp. PlatformUi.kt's own
// tests (PlatformUiTest) keep covering its components.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.R
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import com.budmon.app.ui.theme.TokenSet
import com.budmon.app.ui.theme.Tokens
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs

private const val PX_PER_DP = 3f

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "xxhdpi")
class AppComponentsTest {
    @get:Rule
    val compose = createComposeRule()

    private val modes = listOf(ThemeSetting.LIGHT to Tokens.Teal.Light, ThemeSetting.DARK to Tokens.Teal.Dark)

    /** What the one composition shows; tests change it to cover several modes and variants. */
    private class Shown(val setting: ThemeSetting, val tokens: TokenSet, val content: @Composable () -> Unit)

    private var shown by mutableStateOf<Shown?>(null)
    private var composed = false

    /** Shows `content` in the mode, on its canvas, padded 8 dp (setContent runs once per test). */
    private fun show(setting: ThemeSetting, tokens: TokenSet, content: @Composable () -> Unit) {
        if (!composed) {
            composed = true
            compose.setContent {
                shown?.let { s ->
                    AppTheme(s.setting) {
                        Box(Modifier.background(s.tokens.canvas).padding(8.dp)) { s.content() }
                    }
                }
            }
        }
        compose.runOnUiThread { shown = Shown(setting, tokens, content) }
        compose.waitForIdle()
    }

    /** The tagged node's pixel at (x dp, y dp). */
    private fun pixel(xDp: Float, yDp: Float): Color {
        val map = compose.onNodeWithTag("c").captureToImage().toPixelMap()
        return map[(xDp * PX_PER_DP).toInt(), (yDp * PX_PER_DP).toInt()]
    }

    private fun assertColour(what: String, expected: Color, actual: Color) {
        val channels = listOf(
            expected.red to actual.red,
            expected.green to actual.green,
            expected.blue to actual.blue,
        )
        val close = channels.all { (e, a) -> abs(e * 255 - a * 255) <= 3f }
        assertTrue("$what: expected $expected, got $actual", close)
    }

    private fun fillOf(variant: AppButtonVariant, t: TokenSet): Color = when (variant) {
        AppButtonVariant.Primary -> t.accent
        AppButtonVariant.Destructive -> t.danger
        AppButtonVariant.Secondary, AppButtonVariant.Tertiary -> t.canvas
    }

    // ---- AppButton ----

    @Test
    fun `TP-1_41 AppButton in each variant and mode - 8 dp corners, the variant's fill, Secondary's border, 48 dp`() {
        for ((setting, t) in modes) {
            for (variant in AppButtonVariant.entries) {
                show(setting, t) {
                    AppButton(text = "Save", onClick = {}, modifier = Modifier.testTag("c"), variant = variant)
                }
                val label = "$variant in $setting"

                compose.onNodeWithTag("c").assertHeightIsAtLeast(48.dp)
                assertColour("$label corner (1, 1)", t.canvas, pixel(1f, 1f))
                assertColour("$label edge (4, 24)", fillOf(variant, t), pixel(4f, 24f))
                if (variant == AppButtonVariant.Primary || variant == AppButtonVariant.Destructive) {
                    assertColour("$label past the 8 dp corner (10, 1.5)", fillOf(variant, t), pixel(10f, 1.5f))
                }
                if (variant == AppButtonVariant.Secondary) {
                    assertColour("$label border (12, 0.5)", t.lineStrong, pixel(12f, 0.5f))
                    assertColour("$label border past the corner (10, 0.5)", t.lineStrong, pixel(10f, 0.5f))
                }
            }
        }
    }

    @Test
    fun `TP-1_41 a busy AppButton keeps its label, stays enabled, ignores taps, shows progress, no stateDescription`() {
        var clicks = 0
        show(ThemeSetting.LIGHT, Tokens.Teal.Light) {
            AppButton(
                text = "Save",
                onClick = { clicks += 1 },
                modifier = Modifier.testTag("c"),
                busy = true,
                icon = R.drawable.lucide_check,
            )
        }

        compose.onNodeWithText("Save").assertIsDisplayed()
        val button = compose.onNodeWithTag("c")
        button.assertIsEnabled().performClick()
        assertEquals(0, clicks)
        compose.onNode(
            SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo, ProgressBarRangeInfo.Indeterminate),
            useUnmergedTree = true,
        ).assertExists()
        assertNull(button.fetchSemanticsNode().config.getOrNull(SemanticsProperties.StateDescription))
    }

    @Test
    fun `TP-1_41 an AppButton with an icon and not busy calls onClick and has no progress`() {
        var clicks = 0
        show(ThemeSetting.LIGHT, Tokens.Teal.Light) {
            AppButton(text = "Save", onClick = { clicks += 1 }, modifier = Modifier.testTag("c"), icon = R.drawable.lucide_check)
        }

        compose.onNodeWithTag("c").assertHeightIsAtLeast(48.dp).performClick()

        assertEquals(1, clicks)
        compose.onNode(
            SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo),
            useUnmergedTree = true,
        ).assertDoesNotExist()
    }

    // ---- AppTextField ----

    @Test
    fun `TP-1_41 AppTextField with a hint shows it, with no error semantics`() {
        show(ThemeSetting.LIGHT, Tokens.Teal.Light) {
            AppTextField(value = "", onValueChange = {}, label = "Your name", hint = "As others see it")
        }

        compose.onNodeWithText("As others see it").assertIsDisplayed()
        val field = compose.onNode(hasSetTextAction())
        assertNull(field.fetchSemanticsNode().config.getOrNull(SemanticsProperties.Error))
    }

    @Test
    fun `TP-1_41 AppTextField with an error shows it after a decorative icon and sets Error semantics`() {
        show(ThemeSetting.LIGHT, Tokens.Teal.Light) {
            AppTextField(value = "", onValueChange = {}, label = "Your name", error = "Enter your name.")
        }

        compose.onNodeWithText("Enter your name.").assertIsDisplayed()
        val field = compose.onNode(hasSetTextAction())
        assertEquals("Enter your name.", field.fetchSemanticsNode().config.getOrNull(SemanticsProperties.Error))
        // The icon is decorative: no node describes it.
        compose.onNode(
            SemanticsMatcher.keyIsDefined(SemanticsProperties.ContentDescription) and
                SemanticsMatcher("an alert description") { node ->
                    node.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
                        .any { it.contains("alert", ignoreCase = true) }
                },
            useUnmergedTree = true,
        ).assertDoesNotExist()
    }

    @Test
    fun `TP-1_41 AppTextField with both shows the hint, then the error`() {
        show(ThemeSetting.LIGHT, Tokens.Teal.Light) {
            AppTextField(
                value = "",
                onValueChange = {},
                label = "Your name",
                hint = "As others see it",
                error = "Enter your name.",
            )
        }

        val hint = compose.onNodeWithText("As others see it").assertIsDisplayed().fetchSemanticsNode()
        val error = compose.onNodeWithText("Enter your name.").assertIsDisplayed().fetchSemanticsNode()
        assertTrue("the error is below the hint", error.boundsInRoot.top >= hint.boundsInRoot.bottom)
    }

    // ---- AppPasswordField ----

    @Test
    fun `TP-1_41 the password toggle - Show password then Hide password, no switch semantics, the field keeps focus`() {
        show(ThemeSetting.LIGHT, Tokens.Teal.Light) {
            var value by remember { mutableStateOf("secret phrase") }
            AppPasswordField(value = value, onValueChange = { value = it }, label = "Password")
        }
        val field = compose.onNode(hasSetTextAction())
        field.performClick()
        field.assertIsFocused()

        val show = compose.onNodeWithContentDescription("Show password", useUnmergedTree = true)
        val showConfig = show.fetchSemanticsNode().config
        assertTrue(showConfig.getOrNull(SemanticsProperties.Role) != Role.Switch)
        assertNull(showConfig.getOrNull(SemanticsProperties.ToggleableState))
        assertNull(showConfig.getOrNull(SemanticsProperties.StateDescription))
        show.performClick()

        val hide = compose.onNodeWithContentDescription("Hide password", useUnmergedTree = true)
        hide.assertExists()
        compose.onNodeWithContentDescription("Show password", useUnmergedTree = true).assertDoesNotExist()
        val hideConfig = hide.fetchSemanticsNode().config
        assertNull(hideConfig.getOrNull(SemanticsProperties.ToggleableState))
        assertNull(hideConfig.getOrNull(SemanticsProperties.StateDescription))
        field.assertIsFocused()

        hide.performClick()
        compose.onNodeWithContentDescription("Show password", useUnmergedTree = true).assertExists()
        field.assertIsFocused()
    }

    // ---- Wordmark ----

    @Test
    fun `TP-1_41 Wordmark is wDit with the D in accentFg, laid out LTR, with no content description`() {
        for ((setting, t) in modes) {
            show(setting, t) { Wordmark(modifier = Modifier.testTag("c")) }
            val node = compose.onNodeWithTag("c", useUnmergedTree = true).fetchSemanticsNode()
            val config = node.config

            val text = config.getOrNull(SemanticsProperties.Text).orEmpty()
            assertEquals("wDit", text.joinToString("") { it.text })
            val annotated = text.single()
            val dSpans = annotated.spanStyles.filter { it.start <= 1 && it.end >= 2 }
            assertTrue("a span covers the D in $setting", dSpans.isNotEmpty())
            assertTrue(
                "the D is accentFg in $setting",
                dSpans.any { it.item.color == t.accentFg },
            )
            assertTrue(
                "only the D is accentFg in $setting",
                annotated.spanStyles.none { it.item.color == t.accentFg && (it.start < 1 || it.end > 2) },
            )
            assertNull(config.getOrNull(SemanticsProperties.ContentDescription))
            val layouts = mutableListOf<TextLayoutResult>()
            config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
            assertEquals(TextDirection.Ltr, layouts.single().layoutInput.style.textDirection)
        }
    }
}
