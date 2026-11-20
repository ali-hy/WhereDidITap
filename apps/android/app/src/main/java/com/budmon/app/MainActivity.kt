// The single activity: the update gate (S-1) in front of the app's content.
package com.budmon.app

import android.content.ActivityNotFoundException
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CredentialManager
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.navigation
import com.budmon.app.core.update.UpdateState
import com.budmon.app.identity.ConfirmationCoordinator
import com.budmon.app.identity.InviteViewModel
import com.budmon.app.identity.SecurityViewModel
import com.budmon.app.identity.SessionUiState
import com.budmon.app.identity.SessionViewModel
import com.budmon.app.identity.SignInViewModel
import com.budmon.app.identity.SignOutViewModel
import com.budmon.app.identity.SignedOutReason
import com.budmon.app.identity.TwoStepSetupViewModel
import com.budmon.app.identity.TwoStepViewModel
import com.budmon.app.identity.ui.ConfirmItsYouHost
import com.budmon.app.identity.ui.HomeRoute
import com.budmon.app.identity.ui.InvitationLinkRoute
import com.budmon.app.identity.ui.InviteFlowRoute
import com.budmon.app.identity.ui.SessionLoadingScreen
import com.budmon.app.identity.ui.SecurityRoute
import com.budmon.app.identity.ui.SessionNotLoaded
import com.budmon.app.identity.ui.SignInRoute
import com.budmon.app.identity.ui.TwoStepRoute
import com.budmon.app.identity.ui.TwoStepSetupRoute
import com.budmon.app.ui.platform.OfflineBanner
import com.budmon.app.ui.platform.PlatformStatusViewModel
import com.budmon.app.ui.platform.SyncIndicator
import com.budmon.app.ui.platform.UpdateCard
import com.budmon.app.ui.platform.UpdateRequiredScreen
import com.budmon.app.ui.theme.AppTheme
import com.budmon.app.ui.theme.ThemeSetting
import com.budmon.app.ui.theme.ThemeSettingStore
import com.budmon.app.ui.theme.Tokens
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
import javax.inject.Inject
import javax.inject.Named

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val platform: PlatformStatusViewModel by viewModels()
    private val sessionModel: SessionViewModel by viewModels()

    @Inject @field:Named("apiBaseUrl") lateinit var apiBaseUrl: HttpUrl

    @Inject lateinit var themeSettings: ThemeSettingStore

    @Inject lateinit var confirmation: ConfirmationCoordinator

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The window behind Compose follows the mode, so no light frame shows before it draws.
        val initial = runBlocking { themeSettings.setting.first() }
        applyWindowMode(initial)
        setContent {
            LifecycleEventEffect(Lifecycle.Event.ON_START) { sessionModel.onForeground() }
            LifecycleEventEffect(Lifecycle.Event.ON_STOP) { sessionModel.onBackground() }
            val setting by themeSettings.setting.collectAsStateWithLifecycle(initial)
            AppTheme(setting) {
                Surface(Modifier.fillMaxSize()) {
                    val status by platform.status.collectAsStateWithLifecycle()
                    when (val update = status.update) {
                        is UpdateState.Required -> {
                            UpdateRequiredScreen(
                                pending = status.counts.pending,
                                downloadUrl = status.downloadUrl,
                                onOpenDownload = ::openDownload,
                            )
                        }

                        else -> {
                            val session by sessionModel.state.collectAsStateWithLifecycle()
                            Column {
                                // Signed-out screens need the banner too.
                                OfflineBanner(isOnline = status.isOnline, pending = status.counts.pending)
                                when (val current = session) {
                                    SessionUiState.Loading -> {
                                        SessionLoadingScreen()
                                    }

                                    is SessionUiState.SignedOut -> {
                                        SignedOutHost(current.reason, status.isOnline)
                                    }

                                    is SessionUiState.SignedIn -> {
                                        val nav = rememberNavController()
                                        // Two hosts, so a switch drops the other graph's back stack.
                                        NavHost(nav, startDestination = ROUTE_SIGNED_IN) {
                                            navigation(startDestination = ROUTE_HOME, route = ROUTE_SIGNED_IN) {
                                                composable(ROUTE_HOME) {
                                                    Column {
                                                        Column(
                                                            Modifier.padding(16.dp),
                                                            verticalArrangement = Arrangement.spacedBy(12.dp),
                                                        ) {
                                                            SyncIndicator(
                                                                pending = status.counts.pending,
                                                                syncing = status.syncing,
                                                                failed = status.counts.failed,
                                                            )
                                                            if (update is UpdateState.Available) {
                                                                UpdateCard(
                                                                    onUpdate = { status.downloadUrl?.let(::openDownload) },
                                                                    onLater = platform::dismissUpdate,
                                                                )
                                                            }
                                                        }
                                                        val me = current.me
                                                        if (me != null) {
                                                            HomeRoute(
                                                                me = me,
                                                                isOnline = status.isOnline,
                                                                viewModel = hiltViewModel<SignOutViewModel>(),
                                                                onSignedOut = sessionModel::onSignedOut,
                                                                onSecurity = { nav.navigate(ROUTE_SECURITY) },
                                                            )
                                                        } else {
                                                            val retrying by sessionModel.probing.collectAsStateWithLifecycle()
                                                            SessionNotLoaded(
                                                                status.isOnline,
                                                                current.lastError,
                                                                retrying,
                                                                sessionModel::retry,
                                                            )
                                                        }
                                                    }
                                                }
                                                composable(ROUTE_SECURITY) {
                                                    val me = current.me
                                                    if (me != null) {
                                                        SecurityRoute(
                                                            me = me,
                                                            viewModel = hiltViewModel<SecurityViewModel>(),
                                                            onMeUpdated = sessionModel::onMeUpdated,
                                                            onTurnOn = { nav.navigate("$ROUTE_TWO_STEP_SETUP?mode=setup") },
                                                            onReplace = { nav.navigate("$ROUTE_TWO_STEP_SETUP?mode=replace") },
                                                            onBack = { nav.popBackStack() },
                                                        )
                                                    } else {
                                                        val retrying by sessionModel.probing.collectAsStateWithLifecycle()
                                                        SessionNotLoaded(status.isOnline, current.lastError, retrying, sessionModel::retry)
                                                    }
                                                }
                                                composable(
                                                    "$ROUTE_TWO_STEP_SETUP?mode={mode}",
                                                    arguments = listOf(navArgument("mode") { type = NavType.StringType; defaultValue = "setup" }),
                                                ) { entry ->
                                                    val setup = hiltViewModel<TwoStepSetupViewModel>()
                                                    // Absent when setup was opened without Sign-in & security under it.
                                                    val securityEntry = remember(entry) { runCatching { nav.getBackStackEntry(ROUTE_SECURITY) }.getOrNull() }
                                                    val security: SecurityViewModel? = securityEntry?.let { hiltViewModel(it) }
                                                    TwoStepSetupRoute(
                                                        viewModel = setup,
                                                        replace = entry.arguments?.getString("mode") == "replace",
                                                        onDone = {
                                                            if (setup.replaced) security?.showReplaced()
                                                            nav.popBackStack()
                                                        },
                                                    )
                                                }
                                            }
                                        }
                                        // The step-up sheet, over whichever signed-in screen asked.
                                        ConfirmItsYouHost(confirmation)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /** The signed-out graph: start, invitation link, then the invitation. */
    @Composable
    private fun SignedOutHost(
        reason: SignedOutReason,
        isOnline: Boolean,
    ) {
        val nav = rememberNavController()
        NavHost(nav, startDestination = ROUTE_SIGNED_OUT) {
            navigation(startDestination = ROUTE_SIGN_IN, route = ROUTE_SIGNED_OUT) {
                composable(ROUTE_SIGN_IN) { entry ->
                    // The challenge goes to a graph-scoped view model, never into the route.
                    val twoStep: TwoStepViewModel = hiltViewModel(remember(entry) { nav.getBackStackEntry(ROUTE_SIGNED_OUT) })
                    SignInRoute(
                        viewModel = hiltViewModel<SignInViewModel>(),
                        reason = reason,
                        isOnline = isOnline,
                        savePassword = ::savePassword,
                        onSignedIn = sessionModel::onSignedIn,
                        onHaveLink = { nav.navigate(ROUTE_INVITATION_LINK) },
                        onPrivacy = { openPrivacy() },
                        onTwoStep = {
                            twoStep.start(it)
                            nav.navigate(ROUTE_TWO_STEP)
                        },
                    )
                }
                composable(ROUTE_TWO_STEP) { entry ->
                    val twoStep: TwoStepViewModel = hiltViewModel(remember(entry) { nav.getBackStackEntry(ROUTE_SIGNED_OUT) })
                    val signIn: SignInViewModel = hiltViewModel(remember(entry) { nav.getBackStackEntry(ROUTE_SIGN_IN) })
                    TwoStepRoute(
                        viewModel = twoStep,
                        savePassword = ::savePassword,
                        onSignedIn = sessionModel::onSignedIn,
                        onEnded = { reason ->
                            nav.popBackStack(ROUTE_SIGN_IN, inclusive = false)
                            signIn.showTwoStepEnded(reason)
                        },
                        onBack = { nav.popBackStack() },
                    )
                }
                composable(ROUTE_INVITATION_LINK) { entry ->
                    // The invitation state lives in the graph's view model; the token is never a route.
                    val invite: InviteViewModel = hiltViewModel(remember(entry) { nav.getBackStackEntry(ROUTE_SIGNED_OUT) })
                    InvitationLinkRoute(
                        apiBaseUrl = apiBaseUrl,
                        isOnline = isOnline,
                        onToken = {
                            invite.open(it)
                            nav.navigate(ROUTE_INVITE)
                        },
                        onBack = { nav.popBackStack() },
                    )
                }
                composable(ROUTE_INVITE) { entry ->
                    val invite: InviteViewModel = hiltViewModel(remember(entry) { nav.getBackStackEntry(ROUTE_SIGNED_OUT) })
                    InviteFlowRoute(
                        onBack = { nav.popBackStack() },
                        onSignIn = { nav.popBackStack(ROUTE_SIGN_IN, inclusive = false) },
                        onSignedUp = sessionModel::onSignedIn,
                        onPrivacy = { openPrivacy() },
                        viewModel = invite,
                    )
                }
            }
        }
    }

    /** Offers to save the password with Credential Manager; the caller ignores a failure. */
    private suspend fun savePassword(
        email: String,
        password: String,
    ) {
        CredentialManager.create(this).createCredential(this, CreatePasswordRequest(id = email, password = password))
    }

    /** The canvas as the window and system bar colour, and bar icons that suit the mode. */
    @Suppress("DEPRECATION")
    private fun applyWindowMode(setting: ThemeSetting) {
        val systemDark =
            (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val dark = setting == ThemeSetting.DARK || (setting == ThemeSetting.SYSTEM && systemDark)
        val tokens = if (dark) Tokens.Teal.Dark else Tokens.Teal.Light
        val canvas = tokens.canvas.toArgb()
        window.decorView.setBackgroundColor(canvas)
        window.statusBarColor = canvas
        window.navigationBarColor = canvas
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    private companion object {
        const val ROUTE_SIGNED_OUT = "signed_out"
        const val ROUTE_SIGN_IN = "sign_in"
        const val ROUTE_INVITATION_LINK = "invitation_link"
        const val ROUTE_INVITE = "invite"
        const val ROUTE_SIGNED_IN = "signed_in"
        const val ROUTE_HOME = "home"
        const val ROUTE_TWO_STEP = "two_step"
        const val ROUTE_SECURITY = "settings/security"
        const val ROUTE_TWO_STEP_SETUP = "settings/two_step"
    }

    /** The privacy notice on the API's origin, in a Custom Tab. */
    private fun openPrivacy() {
        openDownload(apiBaseUrl.newBuilder().encodedPath("/privacy").query(null).fragment(null).build().toString())
    }

    /** Opens the APK download in a Custom Tab; false when nothing can open it. */
    private fun openDownload(url: String): Boolean = try {
        CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(url))
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}
