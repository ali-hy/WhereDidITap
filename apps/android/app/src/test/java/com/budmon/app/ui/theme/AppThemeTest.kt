// P-A-513 (6), P-A-516 (c), (d): AppTheme's colour scheme from the generated tokens (guide §15).
// TP-0b.9 (the theme), plus extra cases TP-0b.9x. IDs ending in "x" are test-architect additions,
// not LLD test-plan IDs.
//
// Shapes per P-A-516: AppTheme(setting: ThemeSetting, content); dark = isSystemInDarkTheme() for
// SYSTEM, false for LIGHT, true for DARK; Tokens.Teal.Light / .Dark are TokenSets. Robolectric runs
// at an API level with dynamic colour available, so a scheme equal to the tokens shows it isn't used.
package com.budmon.app.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class AppThemeTest {
    @get:Rule
    val compose = createComposeRule()

    /** The colour scheme AppTheme(setting) provides to its content. */
    private fun schemeFor(setting: ThemeSetting): ColorScheme {
        var captured: ColorScheme? = null
        compose.setContent {
            AppTheme(setting) {
                captured = MaterialTheme.colorScheme
            }
        }
        compose.waitForIdle()
        return captured ?: error("AppTheme rendered no content")
    }

    /** Guide §15's role table for the main roles. */
    private fun assertRoles(tokens: TokenSet, scheme: ColorScheme) {
        assertEquals("primary", tokens.accent, scheme.primary)
        assertEquals("onPrimary", tokens.onAccent, scheme.onPrimary)
        assertEquals("primaryContainer", tokens.accentTint, scheme.primaryContainer)
        assertEquals("onPrimaryContainer", tokens.onAccentTint, scheme.onPrimaryContainer)
        assertEquals("background", tokens.canvas, scheme.background)
        assertEquals("onBackground", tokens.fg, scheme.onBackground)
        assertEquals("surface", tokens.surface, scheme.surface)
        assertEquals("onSurface", tokens.fg, scheme.onSurface)
        assertEquals("surfaceVariant", tokens.surfaceSunken, scheme.surfaceVariant)
        assertEquals("onSurfaceVariant", tokens.fgMuted, scheme.onSurfaceVariant)
        assertEquals("outline", tokens.lineStrong, scheme.outline)
        assertEquals("outlineVariant", tokens.line, scheme.outlineVariant)
        assertEquals("error", tokens.danger, scheme.error)
        assertEquals("onError", tokens.onDanger, scheme.onError)
        assertEquals("errorContainer", tokens.dangerTint, scheme.errorContainer)
        assertEquals("onErrorContainer", tokens.onDangerTint, scheme.onErrorContainer)
        assertEquals("inverseSurface", tokens.inverse, scheme.inverseSurface)
        assertEquals("inverseOnSurface", tokens.onInverse, scheme.inverseOnSurface)
    }

    @Test
    fun `TP-0b_9 AppTheme(LIGHT) has primary = Tokens Teal Light accent`() {
        assertEquals(Tokens.Teal.Light.accent, schemeFor(ThemeSetting.LIGHT).primary)
    }

    @Test
    fun `TP-0b_9 AppTheme(DARK) has primary = Tokens Teal Dark accent`() {
        assertEquals(Tokens.Teal.Dark.accent, schemeFor(ThemeSetting.DARK).primary)
    }

    @Test
    fun `TP-0b_9 AppTheme(SYSTEM) with the system light is the light tokens`() {
        assertEquals(Tokens.Teal.Light.accent, schemeFor(ThemeSetting.SYSTEM).primary)
    }

    @Test
    @Config(qualifiers = "night")
    fun `TP-0b_9 AppTheme(SYSTEM) with the night qualifier is the dark tokens`() {
        assertEquals(Tokens.Teal.Dark.accent, schemeFor(ThemeSetting.SYSTEM).primary)
    }

    @Test
    @Config(qualifiers = "night")
    fun `TP-0b_9x AppTheme(LIGHT) at night stays light`() {
        assertEquals(Tokens.Teal.Light.accent, schemeFor(ThemeSetting.LIGHT).primary)
    }

    @Test
    fun `TP-0b_9x AppTheme(DARK) by day stays dark`() {
        assertEquals(Tokens.Teal.Dark.accent, schemeFor(ThemeSetting.DARK).primary)
    }

    @Test
    fun `TP-0b_9x light mode maps guide section 15's roles from the light tokens, so no dynamic colour`() {
        assertRoles(Tokens.Teal.Light, schemeFor(ThemeSetting.LIGHT))
    }

    @Test
    fun `TP-0b_9x dark mode maps guide section 15's roles from the dark tokens, so no dynamic colour`() {
        assertRoles(Tokens.Teal.Dark, schemeFor(ThemeSetting.DARK))
    }
}
