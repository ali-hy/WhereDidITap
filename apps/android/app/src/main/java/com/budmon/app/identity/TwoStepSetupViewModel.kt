// F-215 (S-4): turning two-step on, or moving it to a new phone. The codes live only in this
// view model's memory.
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
import javax.inject.Inject

enum class SetupStep { Loading, Scan, Codes, Expired, Failed, Done }

data class TwoStepSetupState(
    val step: SetupStep = SetupStep.Loading,
    val secret: TwoStepSecret? = null,
    val code: String = "",
    @StringRes val error: Int? = null,
    val formError: UiText? = null,
    val busy: Boolean = false,
    val codes: List<String> = emptyList(),
    val acknowledged: Boolean = false,
) {
    // The secret, the typed code and the recovery codes stay out of logs.
    override fun toString(): String = "TwoStepSetupState(step=$step, busy=$busy)"
}

@HiltViewModel
class TwoStepSetupViewModel
    @Inject
    constructor(
        private val repository: AuthRepository,
        private val confirmation: ConfirmationCoordinator,
    ) : ViewModel() {
        var state by mutableStateOf(TwoStepSetupState())
            private set

        private var replace = false

        /** True once a replacement was confirmed. */
        var replaced = false
            private set
        private var started = false

        /** Asks for a secret (after a step-up if needed); a second call is ignored. */
        fun start(replace: Boolean) {
            if (started) return
            started = true
            this.replace = replace
            load()
        }

        /** After the setup timed out: a fresh secret. */
        fun startAgain() {
            if (state.busy) return
            load()
        }

        private fun load() {
            state = TwoStepSetupState(step = SetupStep.Loading)
            viewModelScope.launch {
                try {
                    val secret = confirmation.withConfirmation { if (replace) repository.twoStepReplaceStart() else repository.twoStepSetup() }
                    state =
                        if (secret == null) {
                            state.copy(step = SetupStep.Done)
                        } else {
                            state.copy(step = SetupStep.Scan, secret = secret)
                        }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val error = (e as? ApiException)?.error ?: ApiError.Unknown
                    val key = (error as? ApiError.Defined)?.key
                    state =
                        if (key == "TWO_STEP_ALREADY_ENABLED" || key == "TWO_STEP_NOT_ENABLED") {
                            state.copy(step = SetupStep.Done)
                        } else {
                            state.copy(step = SetupStep.Failed, formError = IdentityErrorMessages.forError(error, Operation.Read))
                        }
                }
            }
        }

        fun onCodeChange(value: String) {
            state = state.copy(code = value, error = null, formError = null)
        }

        /** Checks the code and turns two-step on (or swaps the authenticator). */
        fun submit() {
            if (state.busy || state.step != SetupStep.Scan) return
            val code = TwoStepInput.code(state.code)
            if (!TwoStepInput.isCode(code)) {
                state = state.copy(error = R.string.twostep_code_invalid)
                return
            }
            state = state.copy(busy = true, error = null, formError = null)
            viewModelScope.launch {
                try {
                    if (replace) {
                        val done = confirmation.withConfirmation { repository.twoStepReplaceConfirm(code) }
                        if (done != null) replaced = true
                        state = if (done == null) state else state.copy(step = SetupStep.Done, code = "")
                    } else {
                        val codes = confirmation.withConfirmation { repository.twoStepEnable(code) }
                        state = if (codes == null) state else state.copy(step = SetupStep.Codes, codes = codes, code = "")
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    fail(e)
                } finally {
                    state = state.copy(busy = false)
                }
            }
        }

        private fun fail(e: Exception) {
            val error = (e as? ApiException)?.error ?: ApiError.Unknown
            val key = (error as? ApiError.Defined)?.key
            state =
                when (key) {
                    "TWO_STEP_CODE_INVALID" -> state.copy(error = R.string.twostep_setup_clock_hint, code = "")
                    "TWO_STEP_SETUP_EXPIRED" -> state.copy(step = SetupStep.Expired, formError = null)
                    "TWO_STEP_ALREADY_ENABLED", "TWO_STEP_NOT_ENABLED" -> state.copy(step = SetupStep.Done)
                    else -> state.copy(formError = IdentityErrorMessages.forError(error, Operation.Mutation))
                }
        }

        fun onAcknowledgedChange(value: Boolean) {
            state = state.copy(acknowledged = value)
        }

        /** Done on the codes: acknowledges them, then leaves. */
        fun finish() {
            if (state.busy || !state.acknowledged || state.step != SetupStep.Codes) return
            state = state.copy(busy = true, formError = null)
            viewModelScope.launch {
                try {
                    repository.acknowledgeRecoveryCodes()
                    state = state.copy(step = SetupStep.Done, codes = emptyList())
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val error = (e as? ApiException)?.error ?: ApiError.Unknown
                    state = state.copy(formError = IdentityErrorMessages.forError(error, Operation.Mutation))
                } finally {
                    state = state.copy(busy = false)
                }
            }
        }
    }
