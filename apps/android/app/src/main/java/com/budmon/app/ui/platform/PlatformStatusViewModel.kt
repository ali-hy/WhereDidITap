// §8.2 State: the app-scoped update state, outbox counts and connectivity, combined for the UI.
package com.budmon.app.ui.platform

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.budmon.app.core.network.ConnectivityMonitor
import com.budmon.app.core.outbox.OutboxCounts
import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.core.update.UpdateRepository
import com.budmon.app.core.update.UpdateState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PlatformStatus(
    val update: UpdateState = UpdateState.None,
    val downloadUrl: String? = null,
    val counts: OutboxCounts = OutboxCounts(0, 0, 0),
    val isOnline: Boolean = true,
)

@HiltViewModel
class PlatformStatusViewModel
@Inject
constructor(
    private val updates: UpdateRepository,
    dao: OutboxDao,
    connectivity: ConnectivityMonitor,
) : ViewModel() {
    val status: StateFlow<PlatformStatus> =
        combine(updates.state, updates.downloadUrl, dao.observeCounts(), connectivity.isOnline) { update, url, counts, online ->
            PlatformStatus(update, url, counts, online)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlatformStatus())

    init {
        viewModelScope.launch { updates.refresh() }
    }

    fun dismissUpdate() {
        viewModelScope.launch { updates.dismissAvailable() }
    }
}
