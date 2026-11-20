// F-209 (S-4): the second step of a sign-in. Scoped to the signed-out graph; the challenge token
// never enters a route or saved state.
package com.budmon.app.identity

import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.budmon.app.R
import com.budmon.app.core.error.Operation
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import javax.inject.Inject

enum class TwoStepEndReason { TooManyAttempts, Expired }

data class TwoStepFormState(
    val useRecovery: Boolean = false,
    val value: String = "",
    @StringRes val error: Int? = null,
    val formError: UiText? = null,
    val busy: Boolean = false,
    val ownerDialog: Int? = null,
    val showRecoveryHint: Boolean = false,
) {
    // [value] is a code being typed.
    override fun toString(): String = "TwoStepFormState(useRecovery=$useRecovery, busy=$busy)"
}

@HiltViewModel
class TwoStepViewModel
    @Inject
    constructor(
        private val repository: AuthRepository,
        private val guard: OutboxOwnerGuard,
    ) : ViewModel() {
        var form by mutableStateOf(TwoStepFormState())
            private set

        private var challenge: TwoStepChallenge? = null
        private var pending: PendingSignIn? = null
        private var ownerBusy = false

        /** Begins a challenge; any earlier one and the form are dropped. */
        fun start(challenge: TwoStepChallenge) {
            pending?.let { guard.release(it) }
            pending = null
            this.challenge = challenge
            ownerBusy = false
            form = TwoStepFormState()
        }

        fun onValueChange(value: String) {
            form = form.copy(value = value, error = null, formError = null, showRecoveryHint = false)
        }

        fun toggleRecovery() {
            form = form.copy(useRecovery = !form.useRecovery, value = "", error = null, formError = null, showRecoveryHint = false)
        }

        /** Checks the code, verifies it, and on success stores the sign-in and calls [onSignedIn]. */
        fun submit(
            savePassword: suspend (String, String) -> Unit,
            onSignedIn: (Me) -> Unit,
            onEnded: (TwoStepEndReason) -> Unit,
        ) {
            val current = challenge ?: return
            if (form.busy) return
            val recovery = form.useRecovery
            val normal = if (recovery) TwoStepInput.recovery(form.value) else TwoStepInput.code(form.value)
            val valid = if (recovery) TwoStepInput.isRecovery(normal) else TwoStepInput.isCode(normal)
            if (!valid) {
                form =
                    form.copy(
                        error = if (recovery) R.string.twostep_recovery_invalid else R.string.twostep_code_invalid,
                        formError = null,
                        showRecoveryHint = false,
                    )
                return
            }
            form = form.copy(busy = true, error = null, formError = null, showRecoveryHint = false)
            viewModelScope.launch {
                try {
                    val verified = repository.verifyTwoStep(current, if (recovery) null else normal, if (recovery) normal else null)
                    decide(verified.pending, guard.complete(verified.pending), current, savePassword, onSignedIn)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    fail(e, recovery, onEnded)
                } finally {
                    form = form.copy(busy = false)
                }
            }
        }

        private fun fail(
            e: Exception,
            recovery: Boolean,
            onEnded: (TwoStepEndReason) -> Unit,
        ) {
            val error = (e as? ApiException)?.error ?: ApiError.Unknown
            if (error is ApiError.Defined) {
                when (error.key) {
                    "TWO_STEP_CODE_INVALID" -> {
                        form = form.copy(error = R.string.twostep_code_wrong, value = "")
                        return
                    }

                    "TWO_STEP_CHALLENGE_EXPIRED" -> {
                        val reason = (error.data?.get("reason") as? JsonPrimitive)?.content
                        onEnded(if (reason == "too_many_attempts") TwoStepEndReason.TooManyAttempts else TwoStepEndReason.Expired)
                        return
                    }

                    "RATE_LIMITED" -> {
                        form = form.copy(formError = IdentityErrorMessages.forError(error, Operation.Read), showRecoveryHint = !recovery)
                        return
                    }
                }
            }
            form = form.copy(formError = IdentityErrorMessages.forError(error, Operation.Read))
        }

        private suspend fun decide(
            signedIn: PendingSignIn,
            decision: OwnerDecision,
            current: TwoStepChallenge,
            savePassword: suspend (String, String) -> Unit,
            onSignedIn: (Me) -> Unit,
        ) {
            when (decision) {
                OwnerDecision.Proceed -> finish(signedIn, current, savePassword, onSignedIn)

                is OwnerDecision.AskDiscard -> {
                    pending = signedIn
                    form = form.copy(ownerDialog = decision.count)
                }
            }
        }

        private suspend fun finish(
            signedIn: PendingSignIn,
            current: TwoStepChallenge,
            savePassword: suspend (String, String) -> Unit,
            onSignedIn: (Me) -> Unit,
        ) {
            pending = null
            form = form.copy(ownerDialog = null, value = "")
            val password = current.password
            if (password != null) {
                try {
                    savePassword(current.email, password)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // No credential provider, or the user declined.
                }
            }
            onSignedIn(signedIn.me)
        }

        private fun readError(e: Exception): UiText =
            IdentityErrorMessages.forError((e as? ApiException)?.error ?: ApiError.Unknown, Operation.Read)

        /** The dialog's Delete and continue; runs once. */
        fun discardOtherUsersEntries(
            savePassword: suspend (String, String) -> Unit,
            onSignedIn: (Me) -> Unit,
            @Suppress("UNUSED_PARAMETER") onEnded: (TwoStepEndReason) -> Unit,
        ) {
            val held = pending ?: return
            val current = challenge ?: return
            if (ownerBusy) return
            ownerBusy = true
            viewModelScope.launch {
                try {
                    guard.discardAndProceed(held)
                    pending = null
                    finish(held, current, savePassword, onSignedIn)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    form = form.copy(formError = readError(e))
                } finally {
                    ownerBusy = false
                }
            }
        }

        /** The dialog's Cancel and its dismissal: the held sign-in ends, the form stays. */
        fun keepOtherUsersEntries(onCancelled: () -> Unit = {}) {
            val held = pending ?: return
            if (ownerBusy) return
            ownerBusy = true
            viewModelScope.launch {
                try {
                    guard.cancel(held)
                    pending = null
                    form = form.copy(ownerDialog = null, value = "")
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    pending = null
                    form = form.copy(ownerDialog = null, value = "", formError = readError(e))
                } finally {
                    ownerBusy = false
                    onCancelled()
                }
            }
        }

        /** A sign-in still waiting on the dialog is ended. */
        override fun onCleared() {
            pending?.let { guard.release(it) }
            pending = null
        }
    }
