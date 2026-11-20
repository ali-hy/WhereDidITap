// F-214 (S-4, A-101): the two-step actions on Sign-in & security. Scoped to the settings/security
// back-stack entry; the codes live only in this view model's memory.
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

data class TurnOffFormState(
    val useRecovery: Boolean = false,
    val value: String = "",
    @StringRes val error: Int? = null,
    val formError: UiText? = null,
    val showRecoveryHint: Boolean = false,
    val busy: Boolean = false,
) {
    // [value] is a code being typed.
    override fun toString(): String = "TurnOffFormState(useRecovery=$useRecovery, busy=$busy)"
}

data class SecurityState(
    val turnOff: TurnOffFormState? = null,
    val newCodes: List<String>? = null,
    val acknowledged: Boolean = false,
    val busy: Boolean = false,
    val message: UiText? = null,
) {
    // [newCodes] are recovery codes.
    override fun toString(): String = "SecurityState(busy=$busy, acknowledged=$acknowledged)"
}

@HiltViewModel
class SecurityViewModel
    @Inject
    constructor(
        private val repository: AuthRepository,
        private val confirmation: ConfirmationCoordinator,
    ) : ViewModel() {
        var state by mutableStateOf(SecurityState())
            private set

        /** Reads `me` again; any failure is ignored and the shown `me` stays. */
        fun refresh(onMeUpdated: (Me) -> Unit) {
            viewModelScope.launch {
                try {
                    onMeUpdated(repository.getMe())
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // The shown me stays.
                }
            }
        }

        fun openTurnOff() {
            state = state.copy(turnOff = TurnOffFormState())
        }

        fun dismissTurnOff() {
            if (state.turnOff?.busy == true) return
            state = state.copy(turnOff = null)
        }

        fun onTurnOffValueChange(value: String) {
            val form = state.turnOff ?: return
            state = state.copy(turnOff = form.copy(value = value, error = null, formError = null, showRecoveryHint = false))
        }

        fun toggleTurnOffRecovery() {
            val form = state.turnOff ?: return
            state =
                state.copy(
                    turnOff = form.copy(useRecovery = !form.useRecovery, value = "", error = null, formError = null, showRecoveryHint = false),
                )
        }

        /** Checks the code and turns two-step off; the code goes in the request itself. */
        fun submitTurnOff(onMeUpdated: (Me) -> Unit) {
            val form = state.turnOff ?: return
            if (form.busy) return
            val recovery = form.useRecovery
            val normal = if (recovery) TwoStepInput.recovery(form.value) else TwoStepInput.code(form.value)
            val valid = if (recovery) TwoStepInput.isRecovery(normal) else TwoStepInput.isCode(normal)
            if (!valid) {
                state =
                    state.copy(
                        turnOff =
                            form.copy(
                                error = if (recovery) R.string.twostep_recovery_invalid else R.string.twostep_code_invalid,
                                formError = null,
                                showRecoveryHint = false,
                            ),
                    )
                return
            }
            state = state.copy(turnOff = form.copy(busy = true, error = null, formError = null, showRecoveryHint = false))
            viewModelScope.launch {
                try {
                    repository.twoStepDisable(if (recovery) null else normal, if (recovery) normal else null)
                    state = state.copy(turnOff = null, message = UiText(R.string.twostep_off_done))
                    refresh(onMeUpdated)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    failTurnOff(e, recovery, onMeUpdated)
                } finally {
                    state.turnOff?.let { state = state.copy(turnOff = it.copy(busy = false)) }
                }
            }
        }

        private fun failTurnOff(
            e: Exception,
            recovery: Boolean,
            onMeUpdated: (Me) -> Unit,
        ) {
            val form = state.turnOff ?: return
            val error = (e as? ApiException)?.error ?: ApiError.Unknown
            val key = (error as? ApiError.Defined)?.key
            when (key) {
                "TWO_STEP_CODE_INVALID" -> {
                    state = state.copy(turnOff = form.copy(error = R.string.twostep_code_wrong, value = ""))
                }

                "RATE_LIMITED" -> {
                    state =
                        state.copy(
                            turnOff =
                                form.copy(
                                    formError = IdentityErrorMessages.forError(error, Operation.Mutation),
                                    showRecoveryHint = !recovery,
                                ),
                        )
                }

                "TWO_STEP_NOT_ENABLED" -> {
                    state = state.copy(turnOff = null)
                    refresh(onMeUpdated)
                }

                else -> {
                    state = state.copy(turnOff = form.copy(formError = IdentityErrorMessages.forError(error, Operation.Mutation)))
                }
            }
        }

        /** Create new codes: after a step-up if needed, the codes show in place of the section. */
        fun createNewCodes(onMeUpdated: (Me) -> Unit = {}) {
            if (state.busy) return
            state = state.copy(busy = true)
            viewModelScope.launch {
                try {
                    val codes = confirmation.withConfirmation { repository.regenerateRecoveryCodes() }
                    if (codes != null) state = state.copy(newCodes = codes, acknowledged = false)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val error = (e as? ApiException)?.error ?: ApiError.Unknown
                    state = state.copy(message = IdentityErrorMessages.forError(error, Operation.Mutation))
                    if ((error as? ApiError.Defined)?.key == "TWO_STEP_NOT_ENABLED") refresh(onMeUpdated)
                } finally {
                    state = state.copy(busy = false)
                }
            }
        }

        fun onAcknowledgedChange(value: Boolean) {
            state = state.copy(acknowledged = value)
        }

        /** Done on the new codes: acknowledges them, then returns to the section. */
        fun finishNewCodes(onMeUpdated: (Me) -> Unit) {
            if (!state.acknowledged || state.busy) return
            state = state.copy(busy = true)
            viewModelScope.launch {
                try {
                    repository.acknowledgeRecoveryCodes()
                    state = state.copy(newCodes = null, acknowledged = false)
                    refresh(onMeUpdated)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val error = (e as? ApiException)?.error ?: ApiError.Unknown
                    state = state.copy(message = IdentityErrorMessages.forError(error, Operation.Mutation))
                } finally {
                    state = state.copy(busy = false)
                }
            }
        }

        /** Back while the codes show: they stay unacknowledged, so the banner shows. */
        fun leaveNewCodes() {
            state = state.copy(newCodes = null, acknowledged = false)
        }

        fun messageShown() {
            state = state.copy(message = null)
        }
    }
