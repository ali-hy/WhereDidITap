// F-216 (S-4): step-up. `withConfirmation` runs an action; when the server asks for confirmation it
// shows the sheet, waits for the person, and runs the action once more.
package com.budmon.app.identity

import androidx.annotation.StringRes
import com.budmon.app.R
import com.budmon.app.core.error.Operation
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.selects.select
import kotlinx.serialization.json.JsonPrimitive
import javax.inject.Inject
import javax.inject.Singleton

enum class ConfirmFactor { Password, TwoStep, Google }

data class ConfirmFormState(
    val useRecovery: Boolean = false,
    val value: String = "",
    @StringRes val error: Int? = null,
    val formError: UiText? = null,
    val busy: Boolean = false,
)

@Singleton
class ConfirmationCoordinator
    @Inject
    constructor(
        private val repository: AuthRepository,
    ) {
        private class Submission(val password: String?, val code: String?, val recoveryCode: String?)

        private val mutableRequest = MutableStateFlow<ConfirmFactor?>(null)

        /** Non-null while the sheet should show. */
        val request: StateFlow<ConfirmFactor?> = mutableRequest.asStateFlow()

        private val mutableForm = MutableStateFlow(ConfirmFormState())
        val form: StateFlow<ConfirmFormState> = mutableForm.asStateFlow()

        private val lock = Any()
        private var open: CompletableDeferred<Boolean>? = null
        private var submissions = Channel<Submission>(Channel.CONFLATED)

        /**
         * Runs [run]; on CONFIRMATION_REQUIRED asks for the factor, then runs it once more. Null when
         * the person cancels. A call while the sheet is open waits for the same outcome.
         */
        suspend fun <T> withConfirmation(run: suspend () -> T): T? {
            try {
                return run()
            } catch (e: ApiException) {
                val factor = factorOf(e.error) ?: throw e
                if (!ask(factor)) return null
                return run()
            }
        }

        private fun factorOf(error: ApiError): ConfirmFactor? {
            if (error !is ApiError.Defined || error.key != "CONFIRMATION_REQUIRED") return null
            return when ((error.data?.get("factor") as? JsonPrimitive)?.content) {
                "password" -> ConfirmFactor.Password
                "two_step" -> ConfirmFactor.TwoStep
                // Google arrives with S-6.
                else -> null
            }
        }

        private suspend fun ask(factor: ConfirmFactor): Boolean {
            var joined: CompletableDeferred<Boolean>? = null
            val mine = CompletableDeferred<Boolean>()
            val queue: Channel<Submission>
            synchronized(lock) {
                joined = open
                if (joined == null) {
                    open = mine
                    submissions = Channel(Channel.CONFLATED)
                    mutableForm.value = ConfirmFormState()
                    mutableRequest.value = factor
                }
                queue = submissions
            }
            joined?.let { return it.await() }
            var confirmed = false
            try {
                confirmed = serve(mine, queue)
            } finally {
                synchronized(lock) {
                    open = null
                    mutableRequest.value = null
                }
                mine.complete(confirmed)
            }
            return confirmed
        }

        /** Handles submissions until one confirms (true) or the sheet is cancelled (false). */
        private suspend fun serve(
            outcome: CompletableDeferred<Boolean>,
            queue: Channel<Submission>,
        ): Boolean {
            while (true) {
                val next =
                    select<Submission?> {
                        outcome.onAwait { null }
                        queue.onReceive { it }
                    } ?: return false
                mutableForm.value = mutableForm.value.copy(busy = true, error = null, formError = null)
                try {
                    repository.confirm(next.password, next.code, next.recoveryCode)
                    return true
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    showError(e)
                } finally {
                    mutableForm.value = mutableForm.value.copy(busy = false)
                }
            }
        }

        private fun showError(e: Exception) {
            val error = (e as? ApiException)?.error ?: ApiError.Unknown
            val key = (error as? ApiError.Defined)?.key
            mutableForm.value =
                when {
                    key == "INVALID_CREDENTIALS" -> mutableForm.value.copy(error = R.string.error_invalid_credentials)
                    key == "TWO_STEP_CODE_INVALID" -> mutableForm.value.copy(error = R.string.twostep_code_wrong, value = "")
                    else -> mutableForm.value.copy(formError = IdentityErrorMessages.forError(error, Operation.Read))
                }
        }

        fun onValueChange(value: String) {
            mutableForm.value = mutableForm.value.copy(value = value, error = null, formError = null)
        }

        fun toggleRecovery() {
            mutableForm.value = mutableForm.value.copy(useRecovery = !mutableForm.value.useRecovery, value = "", error = null, formError = null)
        }

        /** Sends the form's value as the password, or as the code or recovery code. */
        fun submit() {
            val factor = mutableRequest.value ?: return
            val current = mutableForm.value
            if (current.busy) return
            when (factor) {
                ConfirmFactor.Password -> {
                    send(Submission(current.value, null, null))
                }

                ConfirmFactor.TwoStep -> {
                    val recovery = current.useRecovery
                    val normal = if (recovery) TwoStepInput.recovery(current.value) else TwoStepInput.code(current.value)
                    val valid = if (recovery) TwoStepInput.isRecovery(normal) else TwoStepInput.isCode(normal)
                    if (!valid) {
                        mutableForm.value =
                            current.copy(error = if (recovery) R.string.twostep_recovery_invalid else R.string.twostep_code_invalid)
                        return
                    }
                    send(if (recovery) Submission(null, null, normal) else Submission(null, normal, null))
                }

                ConfirmFactor.Google -> {}
            }
        }

        private fun send(submission: Submission) {
            // Busy at once, so a second tap before the request starts is ignored.
            mutableForm.value = mutableForm.value.copy(busy = true, error = null, formError = null)
            synchronized(lock) { submissions.trySend(submission) }
        }

        fun cancel() {
            synchronized(lock) { open }?.complete(false)
        }
    }
