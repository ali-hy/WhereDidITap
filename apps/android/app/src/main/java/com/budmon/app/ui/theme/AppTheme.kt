// P-A-513 (6), P-A-516 (c): the app's Material theme from the generated tokens (guide §15). Never
// dynamic colour.
package com.budmon.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp

/** Colours Material has no role for: status, income and their tints. */
data class ExtraColors(
    val success: Color,
    val successTint: Color,
    val onSuccessTint: Color,
    val warning: Color,
    val warningTint: Color,
    val onWarningTint: Color,
    val info: Color,
    val infoTint: Color,
    val onInfoTint: Color,
    val income: Color,
    val line: Color,
    val surfaceRaised: Color,
    val focus: Color,
    val accentFg: Color,
)

private fun TokenSet.extras() =
    ExtraColors(
        success = success,
        successTint = successTint,
        onSuccessTint = onSuccessTint,
        warning = warning,
        warningTint = warningTint,
        onWarningTint = onWarningTint,
        info = info,
        infoTint = infoTint,
        onInfoTint = onInfoTint,
        income = income,
        line = line,
        surfaceRaised = surfaceRaised,
        focus = focus,
        accentFg = accentFg,
    )

val LocalExtraColors = staticCompositionLocalOf { Tokens.Teal.Light.extras() }

/** Read like `MaterialTheme.colorScheme`: `AppColors.extra.success`. */
object AppColors {
    val extra: ExtraColors
        @Composable
        @ReadOnlyComposable
        get() = LocalExtraColors.current
}

/** Guide §15's role table; the secondary and tertiary roles reuse the one accent. */
private fun TokenSet.toScheme(dark: Boolean): ColorScheme =
    (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = accent,
        onPrimary = onAccent,
        primaryContainer = accentTint,
        onPrimaryContainer = onAccentTint,
        inversePrimary = accent,
        secondary = accent,
        onSecondary = onAccent,
        secondaryContainer = accentTint,
        onSecondaryContainer = onAccentTint,
        tertiary = accent,
        onTertiary = onAccent,
        tertiaryContainer = accentTint,
        onTertiaryContainer = onAccentTint,
        background = canvas,
        onBackground = fg,
        surface = surface,
        onSurface = fg,
        surfaceVariant = surfaceSunken,
        onSurfaceVariant = fgMuted,
        surfaceTint = accent,
        inverseSurface = inverse,
        inverseOnSurface = onInverse,
        error = danger,
        onError = onDanger,
        errorContainer = dangerTint,
        onErrorContainer = onDangerTint,
        outline = lineStrong,
        outlineVariant = line,
        scrim = Color.Black.copy(alpha = if (dark) 0.6f else 0.45f),
        surfaceBright = surface,
        surfaceDim = surfaceSunken,
        surfaceContainerLowest = surface,
        surfaceContainerLow = surface,
        surfaceContainer = surface,
        surfaceContainerHigh = surfaceRaised,
        surfaceContainerHighest = surfaceRaised,
    )

private val AppShapes =
    Shapes(
        extraSmall = RoundedCornerShape(4.dp),
        small = RoundedCornerShape(8.dp),
        medium = RoundedCornerShape(12.dp),
        large = RoundedCornerShape(12.dp),
        extraLarge = RoundedCornerShape(12.dp),
    )

/** The dark mode for [setting]; `SYSTEM` follows the device. */
@Composable
fun isDark(setting: ThemeSetting): Boolean =
    when (setting) {
        ThemeSetting.SYSTEM -> isSystemInDarkTheme()
        ThemeSetting.LIGHT -> false
        ThemeSetting.DARK -> true
    }

@Composable
fun AppTheme(
    setting: ThemeSetting,
    content: @Composable () -> Unit,
) {
    val dark = isDark(setting)
    val tokens = if (dark) Tokens.Teal.Dark else Tokens.Teal.Light
    val script = LocalConfiguration.current.locales[0]?.language
    CompositionLocalProvider(LocalExtraColors provides tokens.extras()) {
        MaterialTheme(
            colorScheme = tokens.toScheme(dark),
            typography = appTypography(script),
            shapes = AppShapes,
            content = content,
        )
    }
}
