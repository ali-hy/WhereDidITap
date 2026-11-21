// F-207: the app-wide session state (S-1), with sign-out and session events (S-3).
package com.budmon.app.identity

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.budmon.app.core.network.ApiError
import com.budmon.app.core.network.ConnectivityMonitor
import com.budmon.app.identity.store.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Clock
import javax.inject.Inject

enum class SignedOutReason { None, Ended }

sealed interface SessionUiState {
    data object Loading : SessionUiState

    data class SignedOut(val reason: SignedOutReason = SignedOutReason.None) : SessionUiState

    /** [me] is null while the probe failed; [lastError] says why. */
    data class SignedIn(val me: Me?, val lastError: ApiError? = null) : SessionUiState
}

@HiltViewModel
class SessionViewModel
internal constructor(
    private val repository: AuthRepository,
    private val tokenStore: TokenStore,
    private val connectivity: ConnectivityMonitor,
    private val clock: Clock,
    private val sessionEvents: SessionEvents,
    scopeOverride: CoroutineScope?,
) : ViewModel() {
    @Inject
    constructor(
        repository: AuthRepository,
        tokenStore: TokenStore,
        connectivity: ConnectivityMonitor,
        clock: Clock,
        sessionEvents: SessionEvents,
    ) : this(repository, tokenStore, connectivity, clock, sessionEvents, null)

    private val scope: CoroutineScope = scopeOverride ?: viewModelScope
    private val mutableState = MutableStateFlow<SessionUiState>(SessionUiState.Loading)
    val state: StateFlow<SessionUiState> = mutableState.asStateFlow()

    private val mutableProbing = MutableStateFlow(false)

    /** True while a `me.get` probe runs (the Try again button's busy state). */
    val probing: StateFlow<Boolean> = mutableProbing.asStateFlow()

    private var inFlight = false
    private var foreground = false
    private var backoffMs = FIRST_DELAY_MS
    private var timer: Job? = null

    init {
        scope.launch { start() }
        scope.launch {
            sessionEvents.events.collect { event ->
                if (event == SessionEvent.Ended) end(SignedOutReason.Ended)
            }
        }
        scope.launch {
            connectivity.isOnline.collect { online ->
                if (online) trigger() else timer?.cancel()
            }
        }
    }

    private suspend fun start() {
        val stored = tokenStore.read()
        when {
            stored == null -> mutableState.value = SessionUiState.SignedOut()

            // An expired refresh token needs no network to be known.
            !stored.refreshExpiresAt.isAfter(clock.instant()) -> {
                tokenStore.clear()
                mutableState.value = SessionUiState.SignedOut(SignedOutReason.Ended)
            }

            else -> {
                probe()
                scheduleRetry()
            }
        }
    }

    private val waitingForMe: Boolean
        get() = (mutableState.value as? SessionUiState.SignedIn)?.me == null && mutableState.value is SessionUiState.SignedIn

    /** One `me.get` at a time; a call while one runs is ignored. */
    private suspend fun probe() {
        if (inFlight) return
        inFlight = true
        mutableProbing.value = true
        try {
            val me = repository.getMe()
            // A sign-up stored the session before the user's id was known.
            val stored = tokenStore.read()
            if (stored != null && stored.userId != me.id) tokenStore.save(stored.copy(userId = me.id))
            mutableState.value = SessionUiState.SignedIn(me)
        } catch (e: ApiException) {
            val error = e.error
            if (error is ApiError.Defined && error.key == "UNAUTHENTICATED") {
                tokenStore.clear()
                mutableState.value = SessionUiState.SignedOut(SignedOutReason.Ended)
            } else {
                mutableState.value = SessionUiState.SignedIn(null, error)
            }
        } finally {
            inFlight = false
            mutableProbing.value = false
        }
    }

    private fun canRetry(): Boolean = waitingForMe && foreground && connectivity.isOnline.value

    /** The next probes at 15 s, 30 s, … capped at 5 minutes, while online and in the foreground. */
    private fun scheduleRetry() {
        timer?.cancel()
        if (!canRetry()) return
        timer =
            scope.launch {
                while (canRetry()) {
                    delay(backoffMs)
                    if (!canRetry()) break
                    probe()
                    backoffMs = minOf(backoffMs * 2, MAX_DELAY_MS)
                }
            }
    }

    /** Connectivity, foreground and Try again: start over from the short delay. */
    private fun trigger() {
        if (!waitingForMe) return
        backoffMs = FIRST_DELAY_MS
        timer?.cancel()
        scope.launch {
            probe()
            scheduleRetry()
        }
    }

    fun retry() {
        trigger()
    }

    fun onForeground() {
        foreground = true
        trigger()
    }

    fun onBackground() {
        foreground = false
        timer?.cancel()
    }

    private fun end(reason: SignedOutReason) {
        timer?.cancel()
        mutableState.value = SessionUiState.SignedOut(reason)
    }

    /** After a sign-out the user asked for. */
    fun onSignedOut() {
        end(SignedOutReason.None)
    }

    /** After a sign-up or sign-in stored a session. */
    fun onSignedIn(me: Me?) {
        if (me != null) {
            mutableState.value = SessionUiState.SignedIn(me)
            return
        }
        mutableState.value = SessionUiState.Loading
        scope.launch {
            probe()
            scheduleRetry()
        }
    }

    /** A fresher `me` (after a settings change); ignored unless signed in. */
    fun onMeUpdated(me: Me) {
        if (mutableState.value is SessionUiState.SignedIn) mutableState.value = SessionUiState.SignedIn(me)
    }

    private companion object {
        const val FIRST_DELAY_MS = 15_000L
        const val MAX_DELAY_MS = 300_000L
    }
}
