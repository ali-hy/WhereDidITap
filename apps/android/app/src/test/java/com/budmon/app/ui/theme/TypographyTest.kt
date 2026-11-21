// P-A-513 (6), guide §4.1 and §4.2: the type scale, and the family chosen by the app locale's
// language (Arabic → Noto Sans Arabic with room for diacritics; otherwise IBM Plex Sans). TP-0b.9x
// (review B-6 (c)). IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Shapes as built: appTypography(language: String?): Typography; the families PlexSans and
// NotoSansArabic in Fonts.kt; AppTheme reads the language from LocalConfiguration.
package com.budmon.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class TypographyTest {
    @get:Rule
    val compose = createComposeRule()

    private fun Typography.headings() = mapOf("headlineSmall" to headlineSmall, "titleLarge" to titleLarge, "titleMedium" to titleMedium)

    private fun Typography.body() = mapOf("bodyLarge" to bodyLarge, "bodyMedium" to bodyMedium, "bodySmall" to bodySmall)

    private fun Typography.roles() = headings() + body() + mapOf("labelLarge" to labelLarge)

    private fun ratio(style: TextStyle) = style.lineHeight.value / style.fontSize.value

    @Test
    fun `TP-0b_9x appTypography(ar) uses Noto Sans Arabic, body line height at least 1_6 and headings at least 1_4`() {
        val type = appTypography("ar")

        for ((role, style) in type.roles()) assertEquals(role, NotoSansArabic, style.fontFamily)
        for ((role, style) in type.body()) assertTrue("$role: ${ratio(style)}", ratio(style) >= 1.6f)
        for ((role, style) in type.headings()) assertTrue("$role: ${ratio(style)}", ratio(style) >= 1.4f)
        for ((role, style) in type.roles()) assertEquals(role, 0.sp, style.letterSpacing)
    }

    @Test
    fun `TP-0b_9x appTypography(en) uses IBM Plex Sans with guide section 4_2's sizes, line heights and weights`() {
        val type = appTypography("en")
        val expected =
            mapOf(
                "headlineSmall" to Triple(24, 32, FontWeight.SemiBold),
                "titleLarge" to Triple(20, 28, FontWeight.SemiBold),
                "titleMedium" to Triple(16, 24, FontWeight.SemiBold),
                "bodyLarge" to Triple(16, 24, FontWeight.Normal),
                "labelLarge" to Triple(14, 20, FontWeight.Medium),
                "bodyMedium" to Triple(14, 20, FontWeight.Normal),
                "bodySmall" to Triple(12, 16, FontWeight.Normal),
            )

        for ((role, style) in type.roles()) {
            val (size, line, weight) = expected.getValue(role)
            assertEquals(role, PlexSans, style.fontFamily)
            assertEquals(role, size.sp, style.fontSize)
            assertEquals(role, line.sp, style.lineHeight)
            assertEquals(role, weight, style.fontWeight)
        }
    }

    @Test
    fun `TP-0b_9x appTypography with another or no language uses IBM Plex Sans`() {
        assertEquals(PlexSans, appTypography("fr").bodyLarge.fontFamily)
        assertEquals(PlexSans, appTypography(null).bodyLarge.fontFamily)
    }

    private fun themedBodyFamily(): Any? {
        var family: Any? = null
        compose.setContent {
            AppTheme(ThemeSetting.LIGHT) {
                family = MaterialTheme.typography.bodyLarge.fontFamily
            }
        }
        compose.waitForIdle()
        return family
    }

    @Test
    @Config(qualifiers = "ar")
    fun `TP-0b_9x AppTheme under an ar locale selects Noto Sans Arabic`() {
        assertEquals(NotoSansArabic, themedBodyFamily())
    }

    @Test
    @Config(qualifiers = "en")
    fun `TP-0b_9x AppTheme under an en locale selects IBM Plex Sans`() {
        assertEquals(PlexSans, themedBodyFamily())
    }
}
