// F-218 (S-3): sign-out, with the unsynced-entries question.
package com.budmon.app.identity

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.budmon.app.core.error.Operation
import com.budmon.app.core.error.UiText
import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.core.outbox.OutboxRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface SignOutState {
    data object Idle : SignOutState

    data class Confirming(val unsynced: Int) : SignOutState

    data object Busy : SignOutState

    data class Failed(val message: UiText) : SignOutState
}

@HiltViewModel
class SignOutViewModel
    @Inject
    constructor(
        private val repository: AuthRepository,
        private val dao: OutboxDao,
        private val outbox: OutboxRepository,
    ) : ViewModel() {
        var state by mutableStateOf<SignOutState>(SignOutState.Idle)
            private set

        /** Signs out at once when nothing is unsynced; otherwise asks first. */
        fun requestSignOut(onSignedOut: () -> Unit) {
            if (state is SignOutState.Busy) return
            state = SignOutState.Busy
            viewModelScope.launch {
                val unsynced = dao.countAll()
                if (unsynced > 0) {
                    state = SignOutState.Confirming(unsynced)
                } else {
                    run(onSignedOut)
                }
            }
        }

        fun signOutAnyway(onSignedOut: () -> Unit) {
            if (state is SignOutState.Busy) return
            state = SignOutState.Busy
            viewModelScope.launch { run(onSignedOut) }
        }

        /** Asks for a sync and stays signed in. */
        fun syncNow() {
            outbox.kick()
            state = SignOutState.Idle
        }

        fun dismiss() {
            state = SignOutState.Idle
        }

        private suspend fun run(onSignedOut: () -> Unit) {
            state = SignOutState.Busy
            try {
                repository.signOut()
            } catch (e: ApiException) {
                state = SignOutState.Failed(IdentityErrorMessages.forError(e.error, Operation.Mutation))
                return
            }
            state = SignOutState.Idle
            onSignedOut()
        }
    }
