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
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.budmon.app.core.update.UpdateState
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
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val platform: PlatformStatusViewModel by viewModels()

    @Inject lateinit var themeSettings: ThemeSettingStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The window behind Compose follows the mode, so no light frame shows before it draws.
        val initial = runBlocking { themeSettings.setting.first() }
        applyWindowMode(initial)
        setContent {
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
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                OfflineBanner(isOnline = status.isOnline, pending = status.counts.pending)
                                SyncIndicator(pending = status.counts.pending, syncing = status.syncing, failed = status.counts.failed)
                                if (update is UpdateState.Available) {
                                    UpdateCard(
                                        onUpdate = { status.downloadUrl?.let(::openDownload) },
                                        onLater = platform::dismissUpdate,
                                    )
                                }
                                Text(stringResource(R.string.home_placeholder))
                            }
                        }
                    }
                }
            }
        }
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

    /** Opens the APK download in a Custom Tab; false when nothing can open it. */
    private fun openDownload(url: String): Boolean = try {
        CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(url))
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}
