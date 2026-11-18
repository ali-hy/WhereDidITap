// F-215 TwoStepSetupRoute (identity LLD §8.2's S-4 signatures, A-99). TP-4.34, plus TP-4.34x.
// The route runs a real TwoStepSetupViewModel over a MockK AuthRepository and the real
// ConfirmationCoordinator. It is rendered directly: F-214's entry point (the Security screen) isn't
// built before S-8/S-10. The test calls viewModel.start(false) itself, as the LLD doesn't say whether
// the route starts it.
// "No handler" is Robolectric's checkActivities(true): startActivity then throws
// ActivityNotFoundException for an intent nothing resolves.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity.ui

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.R
import com.budmon.app.identity.AuthRepository
import com.budmon.app.identity.ConfirmationCoordinator
import com.budmon.app.identity.TwoStepSecret
import com.budmon.app.identity.TwoStepSetupViewModel
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import io.mockk.coEvery
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import java.time.Instant

@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class TwoStepSetupRouteTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private fun text(id: Int) = context.getString(id)

    private val otpauth = "otpauth://totp/x:mona%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
    private val secret = TwoStepSecret(
        secret = "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP",
        otpauthUri = otpauth,
        expiresAt = Instant.parse("2026-11-15T10:10:00Z"),
    )
    private val repository = mockk<AuthRepository> { coEvery { twoStepSetup() } returns secret }

    private fun secureFlagSet(): Boolean =
        compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    /** Shows the route for setup (not replace), with the secret loaded, while [shown] is true. */
    private fun showSetup(shown: androidx.compose.runtime.MutableState<Boolean> = mutableStateOf(true)) {
        val vm = TwoStepSetupViewModel(repository, ConfirmationCoordinator(repository))
        compose.runOnUiThread { vm.start(false) }
        compose.setContent {
            AppTheme(ThemeSetting.LIGHT) {
                if (shown.value) TwoStepSetupRoute(viewModel = vm, replace = false, onDone = {})
            }
        }
        compose.waitUntilAtLeastOneExists(hasText(text(R.string.twostep_open_app)) and hasClickAction(), timeoutMillis = 5_000)
    }

    private fun openInApp() =
        compose.onNode(hasText(text(R.string.twostep_open_app)) and hasClickAction()).performClick()

    @Test
    fun `TP-4_34 setup with no authenticator app - FLAG_SECURE on the window, Open in authenticator app shows twostep_no_app`() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).checkActivities(true)
        showSetup()

        assertTrue("FLAG_SECURE set while setup is shown", secureFlagSet())
        openInApp()

        compose.waitUntilAtLeastOneExists(hasText(text(R.string.twostep_no_app)), timeoutMillis = 5_000)
        compose.onNodeWithText(text(R.string.twostep_no_app)).assertExists()
    }

    @Test
    fun `TP-4_34x with an authenticator app - Open in authenticator app starts ACTION_VIEW on the otpauth URI, no snackbar`() {
        showSetup()

        openInApp()
        compose.waitForIdle()

        val started: Intent? = shadowOf(compose.activity).nextStartedActivity
        assertEquals(Intent.ACTION_VIEW, started?.action)
        assertEquals(Uri.parse(otpauth), started?.data)
        compose.onNodeWithText(text(R.string.twostep_no_app)).assertDoesNotExist()
    }

    @Test
    fun `TP-4_34x leaving setup - FLAG_SECURE cleared (SecureWindow's dispose)`() {
        val shown = mutableStateOf(true)
        showSetup(shown)
        assertTrue(secureFlagSet())

        compose.runOnIdle { shown.value = false }
        compose.waitForIdle()

        assertEquals(false, secureFlagSet())
    }
}
