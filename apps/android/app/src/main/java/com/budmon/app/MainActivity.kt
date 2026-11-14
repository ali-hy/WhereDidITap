// The single activity: the update gate (S-1) in front of the app's content.
package com.budmon.app

import android.content.ActivityNotFoundException
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.budmon.app.core.update.UpdateState
import com.budmon.app.ui.platform.OfflineBanner
import com.budmon.app.ui.platform.PlatformStatusViewModel
import com.budmon.app.ui.platform.SyncIndicator
import com.budmon.app.ui.platform.UpdateCard
import com.budmon.app.ui.platform.UpdateRequiredScreen
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val platform: PlatformStatusViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
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

    /** Opens the APK download in a Custom Tab; false when nothing can open it. */
    private fun openDownload(url: String): Boolean = try {
        CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(url))
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}
