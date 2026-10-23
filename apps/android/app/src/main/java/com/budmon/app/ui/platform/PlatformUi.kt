// F-258, §8.2: the platform's Compose components.
package com.budmon.app.ui.platform

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.text.BidiFormatter
import com.budmon.app.R
import kotlinx.coroutines.delay
import java.text.NumberFormat

/** A count as text, capped: "<cap>+" above the cap ("99+", "999+"), formatted for the locale. */
private fun capped(count: Int, cap: Int): String {
    val format = NumberFormat.getIntegerInstance()
    return if (count > cap) "${format.format(cap.toLong())}+" else format.format(count.toLong())
}

/** S-1: the full screen while this version is no longer supported. */
@Composable
fun UpdateRequiredScreen(
    pending: Int,
    downloadUrl: String?,
    onOpenDownload: (String) -> Boolean,
    modifier: Modifier = Modifier,
    onRecordOffline: (() -> Unit)? = null,
) {
    var downloadFailed by rememberSaveable { mutableStateOf(false) }
    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, modifier = Modifier.size(48.dp))
        Text(stringResource(R.string.update_required_title), style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Text(stringResource(R.string.update_required_body), textAlign = TextAlign.Center)
        if (pending > 0) {
            // A count above 999 shows "999+"-style text, through the plural's "other" form.
            val text = capped(pending, 999)
            Text(
                pluralStringResource(
                    R.plurals.update_required_pending,
                    if (pending >
                        999
                    ) {
                        1000
                    } else {
                        pending
                    },
                    text,
                ),
                textAlign = TextAlign.Center,
            )
        }
        Button(
            onClick = { downloadFailed = downloadUrl == null || !onOpenDownload(downloadUrl) },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(R.string.update_required_button))
        }
        if (downloadFailed) {
            Text(
                stringResource(R.string.update_download_failed),
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        // The offline route belongs to `transactions`; until it exists the button is hidden.
        if (onRecordOffline != null) {
            TextButton(onClick = onRecordOffline) { Text(stringResource(R.string.update_required_offline)) }
        }
    }
}

/** C-4: shown on home while a newer version is available. */
@Composable
fun UpdateCard(onUpdate: () -> Unit, onLater: () -> Unit, modifier: Modifier = Modifier) {
    Card(modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(stringResource(R.string.update_available))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onUpdate) { Text(stringResource(R.string.update_action)) }
                TextButton(onClick = onLater) { Text(stringResource(R.string.update_later)) }
            }
        }
    }
}

/** S-2: something went wrong; the same behaviour as the web's fallback. */
@Composable
fun ErrorFallbackScreen(
    requestId: String?,
    stillFailing: Boolean,
    busy: Boolean,
    onRetry: () -> Unit,
    onHome: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.error_fallback_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.error_fallback_body))
        if (requestId != null) {
            // The reference reads left to right inside any sentence direction.
            Text(stringResource(R.string.error_reference, BidiFormatter.getInstance().unicodeWrap(requestId.take(8))))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onRetry, enabled = !busy) { Text(stringResource(R.string.error_fallback_retry)) }
            TextButton(onClick = onHome) { Text(stringResource(R.string.error_fallback_home)) }
        }
        Text(
            if (stillFailing) stringResource(R.string.error_fallback_still_failing) else "",
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

/** C-1: offline, then "Back online" for 3 s when connectivity returns. */
@Composable
fun OfflineBanner(isOnline: Boolean, pending: Int, modifier: Modifier = Modifier) {
    var wasOffline by remember { mutableStateOf(!isOnline) }
    var showBack by remember { mutableStateOf(false) }
    LaunchedEffect(isOnline) {
        if (!isOnline) {
            wasOffline = true
            showBack = false
        } else if (wasOffline) {
            wasOffline = false
            showBack = true
            delay(3_000)
            showBack = false
        }
    }
    val text =
        when {
            !isOnline -> stringResource(R.string.offline_banner)
            showBack && pending > 0 -> pluralStringResource(R.plurals.back_online_syncing, pending, pending)
            showBack -> stringResource(R.string.back_online)
            else -> null
        }
    if (text != null) {
        Row(
            modifier = modifier.fillMaxWidth().padding(12.dp).semantics { liveRegion = LiveRegionMode.Polite },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Filled.Info, contentDescription = null)
            Text(text)
        }
    }
}

/** C-2: the app-bar chip: failed first, then syncing, then waiting; hidden when all are 0. */
@Composable
fun SyncIndicator(pending: Int, syncing: Boolean, failed: Int, modifier: Modifier = Modifier) {
    val text =
        when {
            failed > 0 -> pluralStringResource(R.plurals.sync_attention, failed, capped(failed, 99))
            syncing && pending > 0 -> pluralStringResource(R.plurals.sync_in_progress, pending, capped(pending, 99))
            pending > 0 -> pluralStringResource(R.plurals.sync_waiting, pending, capped(pending, 99))
            else -> return
        }
    AssistChip(
        onClick = {},
        label = { Text(text) },
        leadingIcon = { Icon(if (failed > 0) Icons.Filled.Warning else Icons.Filled.Refresh, contentDescription = null) },
        modifier = modifier,
    )
}

/** The per-entry sync state, each with an icon and text (never colour alone). */
enum class SyncChipState { NotSynced, Failed, NeedsConfirmation }

@Composable
fun SyncChip(state: SyncChipState, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val (icon, text) =
        when (state) {
            SyncChipState.NotSynced -> Icons.Filled.Refresh to stringResource(R.string.chip_not_synced)
            SyncChipState.Failed -> Icons.Filled.Warning to stringResource(R.string.chip_failed)
            SyncChipState.NeedsConfirmation -> Icons.Filled.Info to stringResource(R.string.chip_needs_confirmation)
        }
    AssistChip(onClick = onClick, label = { Text(text) }, leadingIcon = { Icon(icon, contentDescription = null) }, modifier = modifier)
}
