// S-1's Android screens and the link route (identity LLD §8.2, A-49's signatures; F-208, F-211, F-212;
// A-45 texts, A-47 privacy links, A-48 link-screen strings, A-60 ask lines). TP-1.47, plus TP-1.47x.
// Screens get fake lambdas that count their calls; InvitationLinkRoute runs with https://budmon.com/.
// TP-1.47's ViewModel part (formError with no inviter) is in InviteViewModelTest.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performFirstLinkClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.R
import com.budmon.app.core.error.UiText
import com.budmon.app.identity.InvitationPreview
import com.budmon.app.identity.InviteProblem
import com.budmon.app.identity.SignUpOptions
import com.budmon.app.identity.SignedOutReason
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import com.budmon.app.ui.theme.Tokens
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant
import kotlin.math.abs

private const val PX_PER_DP = 3f

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "xxhdpi")
class InviteScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private fun text(id: Int) = context.getString(id)

    private val base = "https://budmon.com/".toHttpUrl()
    private val token = "bmi_" + "Ab-_cdEFghIJklMNopQRstUVwxYZ0123456789-_abc"
    private val fullLink = "https://budmon.com/invite#t=$token"
    private val expiresAt = Instant.parse("2026-11-20T10:00:00Z")

    /** Counts a callback's calls. */
    private class Counter {
        var calls = 0
        val call: () -> Unit = { calls += 1 }
    }

    private fun show(content: @Composable () -> Unit) {
        compose.setContent { AppTheme(ThemeSetting.LIGHT) { content() } }
    }

    private fun button(id: Int): SemanticsNodeInteraction = compose.onNodeWithText(text(id)).performScrollTo()

    private fun field(label: String): SemanticsNodeInteraction =
        compose.onNode(hasSetTextAction() and hasContentDescription(label)).performScrollTo()

    private fun preview(inviterName: String?) =
        InvitationPreview(email = "a@x.test", inviterName = inviterName, expiresAt = expiresAt, origin = "direct")

    private fun form(formError: UiText? = null) =
        SetUpFormState(
            name = "",
            password = "",
            currency = "EGP",
            timeZone = "Africa/Cairo",
            language = "en",
            nameError = null,
            passwordError = null,
            currencyError = null,
            timeZoneError = null,
            formError = formError,
            busy = false,
        )

    // ---- Join (F-212, A-45) ----

    @Test
    fun `TP-1_47 JoinScreen with no inviter - This invitation is for the email`() {
        show { JoinScreen(preview = preview(null), busy = false, onUsePassword = {}) }

        compose.onNodeWithText("This invitation is for a@x.test.").assertIsDisplayed()
    }

    @Test
    fun `TP-1_47 JoinScreen with inviter Mona - Mona invited the email to join`() {
        show { JoinScreen(preview = preview("Mona"), busy = false, onUsePassword = {}) }

        compose.onNodeWithText("Mona invited a@x.test to join.").assertIsDisplayed()
    }

    // ---- Problem (F-212, A-42, A-45) ----

    @Test
    fun `TP-1_47 InviteProblemScreen Expired with no inviter - ask anyone, and Sign in calls onSignIn`() {
        val signIn = Counter()
        val retry = Counter()
        show {
            InviteProblemScreen(
                problem = InviteProblem.Expired(expiresAt),
                inviter = null,
                origin = "direct",
                onRetry = retry.call,
                onSignIn = signIn.call,
            )
        }

        compose.onNodeWithText("Ask someone who already has an account to invite you again.").assertIsDisplayed()
        button(R.string.signin_title).performClick()

        assertEquals(1, signIn.calls)
        assertEquals(0, retry.calls)
    }

    /** Shows the problem screen with no-op callbacks. */
    private fun showProblem(problem: InviteProblem, inviter: String?, origin: String?) {
        show { InviteProblemScreen(problem = problem, inviter = inviter, origin = origin, onRetry = {}, onSignIn = {}) }
    }

    private val askMona = "Ask Mona to send a new one."
    private val askAnyone = "Ask someone who already has an account to invite you again."

    @Test
    fun `TP-1_47 InviteProblemScreen Expired with inviter Mona and origin direct - Ask Mona to send a new one`() {
        showProblem(InviteProblem.Expired(expiresAt), inviter = "Mona", origin = "direct")

        compose.onNodeWithText(askMona).assertIsDisplayed()
    }

    @Test
    fun `TP-1_47 InviteProblemScreen Expired with origin bootstrap - no ask line`() {
        showProblem(InviteProblem.Expired(expiresAt), inviter = null, origin = "bootstrap")

        compose.onNodeWithText(text(R.string.invite_problem_title)).assertIsDisplayed()
        compose.onNodeWithText("Ask", substring = true).assertDoesNotExist()
        compose.onNodeWithText(askAnyone).assertDoesNotExist()
    }

    @Test
    fun `TP-1_47 InviteProblemScreen Used(recent = true) with inviter Mona - ready text, no ask line`() {
        showProblem(InviteProblem.Used(recent = true), inviter = "Mona", origin = "direct")

        compose.onNodeWithText(text(R.string.invite_problem_ready)).assertIsDisplayed()
        compose.onNodeWithText(askMona).assertDoesNotExist()
        compose.onNodeWithText(askAnyone).assertDoesNotExist()
    }

    @Test
    fun `TP-1_47 InviteProblemScreen Used(recent = false) with inviter Mona - used text and Ask Mona to send a new one`() {
        showProblem(InviteProblem.Used(recent = false), inviter = "Mona", origin = "direct")

        compose.onNodeWithText(text(R.string.invite_problem_used)).assertIsDisplayed()
        compose.onNodeWithText(askMona).assertIsDisplayed()
    }

    // ---- Start (F-208, A-47) ----

    @Test
    fun `TP-1_47 SignInScreen - Privacy notice calls onPrivacy once, I have an invitation link calls onHaveLink`() {
        val privacy = Counter()
        val haveLink = Counter()
        show {
            SignInScreen(reason = SignedOutReason.None, isOnline = true, onHaveLink = haveLink.call, onPrivacy = privacy.call)
        }

        button(R.string.signin_privacy).performClick()
        assertEquals(1, privacy.calls)
        assertEquals(0, haveLink.calls)

        button(R.string.signin_have_link).performClick()
        assertEquals(1, haveLink.calls)
        assertEquals(1, privacy.calls)
    }

    // ---- Set-up (F-212, A-47) ----

    @Test
    fun `TP-1_47 SetUpAccountScreen - the privacy link calls onPrivacy once, Create account calls onSubmit, the name field onNameChange`() {
        val privacy = Counter()
        val submit = Counter()
        val names = mutableListOf<String>()
        show {
            SetUpAccountScreen(
                email = "a@x.test",
                options = SignUpOptions(currencies = listOf("EGP", "USD"), locales = listOf("en", "ar")),
                form = form(),
                onNameChange = { names += it },
                onPasswordChange = {},
                onCurrencyChange = {},
                onTimeZoneChange = {},
                onLanguageChange = {},
                onSubmit = submit.call,
                onPrivacy = privacy.call,
            )
        }

        compose.onNodeWithText(text(R.string.setup_privacy)).performScrollTo().performFirstLinkClick()
        assertEquals(1, privacy.calls)
        assertEquals(0, submit.calls)

        button(R.string.setup_submit).performClick()
        assertEquals(1, submit.calls)
        assertEquals(1, privacy.calls)

        field(text(R.string.setup_name)).performTextInput("M")
        assertEquals(listOf("M"), names)
    }

    @Test
    fun `TP-1_47x SetUpAccountScreen shows formError invite_full_no_inviter as its text`() {
        show {
            SetUpAccountScreen(
                email = "a@x.test",
                options = SignUpOptions(currencies = listOf("EGP"), locales = listOf("en")),
                form = form(UiText(R.string.invite_full_no_inviter)),
                onNameChange = {},
                onPasswordChange = {},
                onCurrencyChange = {},
                onTimeZoneChange = {},
                onLanguageChange = {},
                onSubmit = {},
                onPrivacy = {},
            )
        }

        compose.onNodeWithText("There's no room for new people right now. The administrator has been told.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    // ---- Link screen (F-211, A-48) ----

    @Test
    fun `TP-1_47 InvitationLinkScreen - heading, instruction, field, Paste, Continue disabled when blank, Back to sign in`() {
        val paste = Counter()
        val proceed = Counter()
        val back = Counter()
        var current by mutableStateOf("")
        show {
            InvitationLinkScreen(
                text = current,
                error = null,
                onTextChange = {},
                onPaste = paste.call,
                onContinue = proceed.call,
                onBack = back.call,
            )
        }

        compose.onNode(isHeading() and hasText("Open your invitation")).assertIsDisplayed()
        compose.onNodeWithText("Paste the link from your invitation email.").assertIsDisplayed()
        field("Invitation link").assertIsDisplayed()

        button(R.string.invite_link_paste).performClick()
        assertEquals(1, paste.calls)

        button(R.string.invite_link_continue).assertIsNotEnabled().performClick()
        compose.runOnUiThread { current = "   " }
        compose.waitForIdle()
        button(R.string.invite_link_continue).assertIsNotEnabled().performClick()
        assertEquals(0, proceed.calls)

        compose.runOnUiThread { current = fullLink }
        compose.waitForIdle()
        button(R.string.invite_link_continue).assertIsEnabled().performClick()
        assertEquals(1, proceed.calls)

        button(R.string.invite_link_back).performClick()
        assertEquals(1, back.calls)
        assertEquals(1, paste.calls)
    }

    @Test
    fun `TP-1_47 InvitationLinkScreen - Continue is the primary button (the accent fill)`() {
        show {
            InvitationLinkScreen(text = fullLink, error = null, onTextChange = {}, onPaste = {}, onContinue = {}, onBack = {})
        }

        val map = button(R.string.invite_link_continue).captureToImage().toPixelMap()
        val actual = map[(4 * PX_PER_DP).toInt(), (24 * PX_PER_DP).toInt()]
        assertColour("Continue's fill at (4, 24) dp", Tokens.Teal.Light.accent, actual)
    }

    // ---- Link route (F-211, A-49) ----

    private fun showRoute(isOnline: Boolean, tokens: MutableList<String>) {
        show { InvitationLinkRoute(apiBaseUrl = base, isOnline = isOnline, onToken = { tokens += it }, onBack = {}) }
    }

    private fun typeAndContinue(value: String) {
        field("Invitation link").performTextInput(value)
        button(R.string.invite_link_continue).performClick()
    }

    @Test
    fun `TP-1_47 InvitationLinkRoute - a full link and Continue calls onToken with the token`() {
        val tokens = mutableListOf<String>()
        showRoute(isOnline = true, tokens)

        typeAndContinue(fullLink)

        assertEquals(listOf(token), tokens)
    }

    @Test
    fun `TP-1_47 InvitationLinkRoute - a link to another page shows invite_link_not_invitation`() {
        val tokens = mutableListOf<String>()
        showRoute(isOnline = true, tokens)

        typeAndContinue("https://budmon.com/x")

        compose.onNodeWithText("This isn't an invitation link. Copy the whole link from the email.").assertIsDisplayed()
        assertTrue(tokens.isEmpty())
    }

    @Test
    fun `TP-1_47 InvitationLinkRoute offline - a full link shows invite_link_offline and onToken is not called`() {
        val tokens = mutableListOf<String>()
        showRoute(isOnline = false, tokens)

        typeAndContinue(fullLink)

        compose.onNodeWithText("You're offline. Connect to open your invitation.").assertIsDisplayed()
        assertTrue(tokens.isEmpty())
    }

    @Test
    fun `TP-1_47x InvitationLinkRoute - another server's link shows invite_link_other_server`() {
        val tokens = mutableListOf<String>()
        showRoute(isOnline = true, tokens)

        typeAndContinue("https://budmon.com:8443/invite#t=$token")

        compose.onNodeWithText("This link is for a different server.").assertIsDisplayed()
        assertTrue(tokens.isEmpty())
    }

    @Test
    fun `TP-1_47x InvitationLinkRoute - typing after an error clears it`() {
        val tokens = mutableListOf<String>()
        showRoute(isOnline = true, tokens)
        val error = "This isn't an invitation link. Copy the whole link from the email."
        typeAndContinue("https://budmon.com/x")
        compose.onNodeWithText(error).assertIsDisplayed()

        field("Invitation link").performTextInput("y")

        compose.onNodeWithText(error).assertDoesNotExist()
    }

    @Test
    fun `TP-1_47x InvitationLinkRoute - Paste fills the field from the clipboard, and Continue then calls onToken`() {
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        clipboard.setPrimaryClip(ClipData.newPlainText("invitation", fullLink))
        val tokens = mutableListOf<String>()
        showRoute(isOnline = true, tokens)

        button(R.string.invite_link_paste).performClick()

        val shown = field("Invitation link").fetchSemanticsNode().config[SemanticsProperties.EditableText].text
        assertEquals(fullLink, shown)
        button(R.string.invite_link_continue).performClick()
        assertEquals(listOf(token), tokens)
    }

    private fun assertColour(what: String, expected: Color, actual: Color) {
        val channels = listOf(expected.red to actual.red, expected.green to actual.green, expected.blue to actual.blue)
        val close = channels.all { (e, a) -> abs(e * 255 - a * 255) <= 3f }
        assertTrue("$what: expected $expected, got $actual", close)
    }
}
