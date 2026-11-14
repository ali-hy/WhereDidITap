// P-A-513 (6): the bundled families and the type scale (UX guide §4). The family follows the app
// locale's script: Arabic uses Noto Sans Arabic, everything else Plex Sans.
package com.budmon.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.budmon.app.R

val PlexSans =
    FontFamily(
        Font(R.font.ibm_plex_sans_regular, FontWeight.Normal),
        Font(R.font.ibm_plex_sans_medium, FontWeight.Medium),
        Font(R.font.ibm_plex_sans_semibold, FontWeight.SemiBold),
    )

val PlexMono =
    FontFamily(
        Font(R.font.ibm_plex_mono_regular, FontWeight.Normal),
        Font(R.font.ibm_plex_mono_medium, FontWeight.Medium),
    )

val NotoSansArabic =
    FontFamily(
        Font(R.font.noto_sans_arabic_regular, FontWeight.Normal),
        Font(R.font.noto_sans_arabic_medium, FontWeight.Medium),
        Font(R.font.noto_sans_arabic_semibold, FontWeight.SemiBold),
    )

private fun style(
    family: FontFamily,
    weight: FontWeight,
    size: Int,
    line: Int,
    arabic: Boolean,
): TextStyle {
    // Arabic needs room for diacritics: body at least 1.6, headings at least 1.4.
    val minRatio = if (size >= 20) 1.4 else 1.6
    val height: TextUnit = if (arabic) maxOf(line.toDouble(), size * minRatio).sp else line.sp
    return TextStyle(
        fontFamily = family,
        fontWeight = weight,
        fontSize = size.sp,
        lineHeight = height,
        letterSpacing = 0.sp,
    )
}

/** The guide's §4.2 roles; [language] is the app locale's language code. */
fun appTypography(language: String?): Typography {
    val arabic = language == "ar"
    val family = if (arabic) NotoSansArabic else PlexSans
    fun s(
        weight: FontWeight,
        size: Int,
        line: Int,
    ) = style(family, weight, size, line, arabic)
    return Typography(
        headlineSmall = s(FontWeight.SemiBold, 24, 32),
        titleLarge = s(FontWeight.SemiBold, 20, 28),
        titleMedium = s(FontWeight.SemiBold, 16, 24),
        bodyLarge = s(FontWeight.Normal, 16, 24),
        labelLarge = s(FontWeight.Medium, 14, 20),
        bodyMedium = s(FontWeight.Normal, 14, 20),
        bodySmall = s(FontWeight.Normal, 12, 16),
    )
}
