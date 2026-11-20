// F-215 TwoStepSetupRoute and TwoStepSetupScreen (identity LLD §8.2's S-4 signatures, A-99, A-100,
// A-102, A-104). TP-4.34, plus TP-4.34x (Copy and Copy all mark the clip with EXTRA_IS_SENSITIVE,
// F-215). TP-4.45 (c) and (d), plus TP-4.45x (Verify in replace mode calls onSubmit; A-104's
// strings; Copy all's "Copied." below Android 13, as A-104 says for both buttons). The Expired and
// Scan steps (A-102) render the stateless screen with counting lambdas.
// (d) runs the route under @Config(sdk = [32]) and [33]; Robolectric fetches those SDKs' jars.
// (c) and (d) match the texts TP-4.45 lists; A-104's new string IDs are looked up by name, so a
// missing one fails its own test rather than the build.
// The route runs a real TwoStepSetupViewModel over a MockK AuthRepository and the real
// ConfirmationCoordinator. It is rendered directly: SecurityScreen's Turn on only navigates to
// settings/two_step?mode=setup (A-100, no navigation seam), and that route starts the view model
// itself ("asks for the step-up on start", §8.2), so the tests never call start().
// "No handler" is Robolectric's checkActivities(true): startActivity then throws
// ActivityNotFoundException for an intent nothing resolves.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity.ui

import android.app.Application
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.R
import com.budmon.app.identity.AuthRepository
import com.budmon.app.identity.ConfirmationCoordinator
import com.budmon.app.identity.SetupStep
import com.budmon.app.identity.TwoStepSecret
import com.budmon.app.identity.TwoStepSetupState
import com.budmon.app.identity.TwoStepSetupViewModel
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
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
    private val repository = mockk<AuthRepository> {
        coEvery { twoStepSetup() } returns secret
        coEvery { twoStepReplaceStart() } returns secret
    }

    private fun secureFlagSet(): Boolean =
        compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    /** Shows the route (setup unless [replace]) while [shown] is true, and waits for the secret. */
    private fun showSetup(
        shown: androidx.compose.runtime.MutableState<Boolean> = mutableStateOf(true),
        replace: Boolean = false,
    ): TwoStepSetupViewModel {
        val vm = TwoStepSetupViewModel(repository, ConfirmationCoordinator(repository))
        compose.setContent {
            AppTheme(ThemeSetting.LIGHT) {
                if (shown.value) TwoStepSetupRoute(viewModel = vm, replace = replace, onDone = {})
            }
        }
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            vm.state.step == SetupStep.Scan
        }
        compose.waitUntilAtLeastOneExists(hasText(text(R.string.twostep_open_app)) and hasClickAction(), timeoutMillis = 5_000)
        return vm
    }

    /** Scrolls the node into view when its screen scrolls (a tap lands only inside the window). */
    private fun SemanticsNodeInteraction.inView(): SemanticsNodeInteraction {
        var parent = fetchSemanticsNode().parent
        while (parent != null) {
            if (parent.config.contains(SemanticsActions.ScrollBy)) return performScrollTo()
            parent = parent.parent
        }
        return this
    }

    private fun openInApp() =
        compose.onNode(hasText(text(R.string.twostep_open_app)) and hasClickAction()).inView().performClick()

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

    @Test
    fun `TP-4_34x the route for setup starts itself - twoStepSetup once, never twoStepReplaceStart`() {
        showSetup()

        coVerify(exactly = 1) { repository.twoStepSetup() }
        coVerify(exactly = 0) { repository.twoStepReplaceStart() }
    }

    @Test
    fun `TP-4_34x the route for replace starts itself - twoStepReplaceStart once, never twoStepSetup`() {
        showSetup(replace = true)

        coVerify(exactly = 1) { repository.twoStepReplaceStart() }
        coVerify(exactly = 0) { repository.twoStepSetup() }
    }

    // ---- TwoStepSetupScreen's steps (A-102) ----

    private class Counter {
        var calls = 0
        val call: () -> Unit = { calls += 1 }
    }

    private class Lambdas {
        val submit = Counter()
        val openInApp = Counter()
        val copyKey = Counter()
        val startAgain = Counter()
        fun calls() = listOf(submit.calls, openInApp.calls, copyKey.calls, startAgain.calls)
    }

    private fun state(step: SetupStep) = TwoStepSetupState(
        step = step,
        secret = secret,
        code = "",
        error = null,
        formError = null,
        busy = false,
        codes = emptyList(),
        acknowledged = false,
    )

    private fun showScreen(step: SetupStep, lambdas: Lambdas) {
        compose.setContent {
            AppTheme(ThemeSetting.LIGHT) {
                TwoStepSetupScreen(
                    state = state(step),
                    onCodeChange = {},
                    onSubmit = lambdas.submit.call,
                    onOpenInApp = lambdas.openInApp.call,
                    onCopyKey = lambdas.copyKey.call,
                    onStartAgain = lambdas.startAgain.call,
                )
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `TP-4_34 TwoStepSetupScreen Expired - Setup timed out, Start again calling onStartAgain only (A-102)`() {
        val lambdas = Lambdas()
        showScreen(SetupStep.Expired, lambdas)

        compose.onNodeWithText(text(R.string.twostep_setup_expired)).assertExists()
        compose.onNode(hasText(text(R.string.twostep_setup_start_again)) and hasClickAction()).inView().performClick()

        assertEquals(listOf(0, 0, 0, 1), lambdas.calls())
    }

    @Test
    fun `TP-4_34x TwoStepSetupScreen Expired - no Try again button (A-102)`() {
        showScreen(SetupStep.Expired, Lambdas())

        compose.onNode(hasText(text(R.string.error_fallback_retry)) and hasClickAction()).assertDoesNotExist()
    }

    @Test
    fun `TP-4_34 TwoStepSetupScreen Scan - a Copy button (A-102)`() {
        showScreen(SetupStep.Scan, Lambdas())

        compose.onNode(hasText(text(R.string.twostep_setup_copy)) and hasClickAction()).inView().assertExists()
    }

    @Test
    fun `TP-4_34x TwoStepSetupScreen Scan - Copy calls onCopyKey only`() {
        val lambdas = Lambdas()
        showScreen(SetupStep.Scan, lambdas)

        compose.onNode(hasText(text(R.string.twostep_setup_copy)) and hasClickAction()).inView().performClick()

        assertEquals(listOf(0, 0, 1, 0), lambdas.calls())
    }

    // ---- TP-4.45 (c), A-104: the Scan step's wording by mode ----

    private fun showScan(replace: Boolean) {
        compose.setContent {
            AppTheme(ThemeSetting.LIGHT) {
                TwoStepSetupScreen(
                    state = state(SetupStep.Scan),
                    onCodeChange = {},
                    onSubmit = {},
                    onOpenInApp = {},
                    onCopyKey = {},
                    onStartAgain = {},
                    replace = replace,
                )
            }
        }
        compose.waitForIdle()
    }

    private fun exists(text: String) = compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun `TP-4_45 TwoStepSetupScreen Scan, setup - Turn on two-step verification, Step 1 of 2, Scan this code, Verify and turn on`() {
        showScan(replace = false)

        assertTrue("heading", exists("Turn on two-step verification"))
        assertTrue("step line", exists("Step 1 of 2"))
        assertTrue("scan title", exists("Scan this code"))
        compose.onNode(hasText("Verify and turn on") and hasClickAction()).inView().assertExists()
        compose.onNode(hasText("Replace authenticator app")).assertDoesNotExist()
    }

    @Test
    fun `TP-4_45 TwoStepSetupScreen Scan, replace - Replace authenticator app, no Step text, Scan this code, Verify`() {
        showScan(replace = true)

        assertTrue("heading", exists("Replace authenticator app"))
        compose.onAllNodes(hasText("Step", substring = true)).assertCountEquals(0)
        assertTrue("scan title", exists("Scan this code"))
        compose.onNode(hasText("Verify") and hasClickAction()).inView().assertExists()
        compose.onNode(hasText("Verify and turn on")).assertDoesNotExist()
        compose.onNode(hasText("Turn on two-step verification")).assertDoesNotExist()
    }

    @Test
    fun `TP-4_45x TwoStepSetupScreen Scan, replace - Verify calls onSubmit`() {
        val submit = Counter()
        compose.setContent {
            AppTheme(ThemeSetting.LIGHT) {
                TwoStepSetupScreen(
                    state = state(SetupStep.Scan),
                    onCodeChange = {},
                    onSubmit = submit.call,
                    onOpenInApp = {},
                    onCopyKey = {},
                    onStartAgain = {},
                    replace = true,
                )
            }
        }

        compose.onNode(hasText("Verify") and hasClickAction()).inView().performClick()

        assertEquals(1, submit.calls)
    }

    @Test
    fun `TP-4_45x the A-104 strings have the texts of §8_1`() {
        val expected = mapOf(
            "twostep_setup_title" to "Turn on two-step verification",
            "twostep_setup_scan" to "Scan this code",
            "twostep_setup_submit" to "Verify and turn on",
            "twostep_replace" to "Replace authenticator app",
            "twostep_replaced" to "Your authenticator app was replaced.",
            "twostep_verify" to "Verify",
            "twostep_copied" to "Copied.",
        )
        for ((name, value) in expected) {
            val id = context.resources.getIdentifier(name, "string", context.packageName)
            assertTrue("string $name exists", id != 0)
            assertEquals(name, value, text(id))
        }
        assertEquals("Step 1 of 2", context.getString(R.string.twostep_setup_step, 1))
    }

    // ---- TP-4.45 (d), A-104: Copy's confirmation below Android 13 ----

    private val clipboard: ClipboardManager
        get() = compose.activity.getSystemService(ClipboardManager::class.java)

    private fun copyKey() =
        compose.onNode(hasText(text(R.string.twostep_setup_copy)) and hasClickAction()).inView().performClick()

    @Test
    @Config(sdk = [32])
    fun `TP-4_45 Copy on the route at API 32 - snackbar Copied, the clipboard holds the key without spaces`() {
        showSetup()

        copyKey()

        compose.waitUntilAtLeastOneExists(hasText("Copied."), timeoutMillis = 5_000)
        assertEquals("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", clipboard.primaryClip?.getItemAt(0)?.text?.toString())
    }

    @Test
    @Config(sdk = [33])
    fun `TP-4_45 Copy on the route at API 33 - no Copied snackbar, the clipboard holds the key without spaces`() {
        showSetup()

        copyKey()
        compose.waitForIdle()

        assertEquals("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", clipboard.primaryClip?.getItemAt(0)?.text?.toString())
        compose.onNode(hasText("Copied.")).assertDoesNotExist()
    }

    // ---- F-215: the clip is marked sensitive (TP-4.34x) ----

    private fun clipIsSensitive(): Boolean =
        clipboard.primaryClip?.description?.extras?.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE, false) == true

    @Test
    fun `TP-4_34x Copy on the route - the clip's description carries EXTRA_IS_SENSITIVE true`() {
        showSetup()

        copyKey()
        compose.waitForIdle()

        assertTrue("EXTRA_IS_SENSITIVE set", clipIsSensitive())
    }

    /** The route on the Codes step: 123456 typed and Verify and turn on tapped. */
    private fun showCodes(): TwoStepSetupViewModel {
        coEvery { repository.twoStepEnable("123456") } returns codes
        val vm = showSetup()
        compose.onNode(hasContentDescription(text(R.string.twostep_code)) and hasSetTextAction()).inView().performTextInput("123456")
        compose.onNode(hasText(text(R.string.twostep_setup_submit)) and hasClickAction()).inView().performClick()
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            vm.state.step == SetupStep.Codes
        }
        compose.waitUntilAtLeastOneExists(hasText(text(R.string.twostep_codes_copy)) and hasClickAction(), timeoutMillis = 5_000)
        return vm
    }

    private val codes = "ABCDEFGHJK".map { "7KQ2-M3XD-4TR$it" }

    private fun copyAll() =
        compose.onNode(hasText(text(R.string.twostep_codes_copy)) and hasClickAction()).inView().performClick()

    @Test
    fun `TP-4_34x Copy all on the route - the clip carries EXTRA_IS_SENSITIVE true and every code`() {
        showCodes()

        copyAll()
        compose.waitForIdle()

        assertTrue("EXTRA_IS_SENSITIVE set", clipIsSensitive())
        val copied = clipboard.primaryClip?.getItemAt(0)?.text?.toString().orEmpty()
        for (code in codes) assertTrue("$code copied", copied.contains(code))
    }

    @Test
    @Config(sdk = [32])
    fun `TP-4_45x Copy all on the route at API 32 - snackbar Copied (A-104)`() {
        showCodes()

        copyAll()

        compose.waitUntilAtLeastOneExists(hasText("Copied."), timeoutMillis = 5_000)
    }

    @Test
    @Config(sdk = [33])
    fun `TP-4_45x Copy all on the route at API 33 - no Copied snackbar (A-104)`() {
        showCodes()

        copyAll()
        compose.waitForIdle()

        compose.onNode(hasText("Copied.")).assertDoesNotExist()
    }

    @Test
    fun `TP-4_34x the setup strings have the texts of §8_1 (A-102)`() {
        val expected = mapOf<Int, String>(
            R.string.twostep_setup_expired to "Setup timed out. Start again.",
            R.string.twostep_setup_start_again to "Start again",
            R.string.twostep_setup_copy to "Copy",
        )
        for ((id, value) in expected) assertEquals(value, text(id))
    }
}
