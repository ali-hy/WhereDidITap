// F-208 (S-3): the sign-in form's state and the password sign-in.
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
import com.budmon.app.identity.store.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import javax.inject.Inject

/** [ownerDialog] is the number of another user's entries to ask about, or null. */
data class SignInFormState(
    val email: String = "",
    val password: String = "",
    @StringRes val emailError: Int? = null,
    @StringRes val passwordError: Int? = null,
    val formError: UiText? = null,
    val busy: Boolean = false,
    val ownerDialog: Int? = null,
)

@HiltViewModel
class SignInViewModel
    @Inject
    constructor(
        private val repository: AuthRepository,
        private val guard: OutboxOwnerGuard,
        private val tokenStore: TokenStore,
    ) : ViewModel() {
        var form by mutableStateOf(SignInFormState())
            private set

        private var pending: PendingSignIn? = null

        init {
            viewModelScope.launch {
                val last = tokenStore.lastEmail()
                if (last != null && form.email.isEmpty()) form = form.copy(email = last)
            }
        }

        fun onEmailChange(value: String) {
            form = form.copy(email = value, emailError = null, formError = null)
        }

        fun onPasswordChange(value: String) {
            form = form.copy(password = value, passwordError = null, formError = null)
        }

        /** Checks the form, signs in, and on success saves the password and calls [onSignedIn]. */
        fun submit(
            isOnline: Boolean,
            savePassword: suspend (String, String) -> Unit,
            onSignedIn: (Me) -> Unit,
        ) {
            if (form.busy) return
            val email = form.email.trim()
            val password = form.password
            val emailError =
                when {
                    email.isEmpty() -> R.string.form_email_required
                    !email.contains('@') -> R.string.form_email_invalid
                    else -> null
                }
            val passwordError = if (password.isEmpty()) R.string.form_password_required else null
            form = form.copy(emailError = emailError, passwordError = passwordError, formError = null)
            if (emailError != null || passwordError != null) return
            if (!isOnline) {
                form = form.copy(formError = UiText(R.string.signin_offline))
                return
            }
            form = form.copy(busy = true)
            viewModelScope.launch {
                try {
                    when (val outcome = repository.signIn(email, password)) {
                        is SignInOutcome.Ready -> decide(outcome.pending, guard.complete(outcome.pending), savePassword, onSignedIn)
                        is SignInOutcome.TwoStepRequired -> form = form.copy(formError = UiText(R.string.error_generic_read))
                    }
                } catch (e: ApiException) {
                    form = form.copy(formError = IdentityErrorMessages.forError(e.error, Operation.Read))
                } finally {
                    form = form.copy(busy = false)
                }
            }
        }

        private suspend fun decide(
            signedIn: PendingSignIn,
            decision: OwnerDecision,
            savePassword: suspend (String, String) -> Unit,
            onSignedIn: (Me) -> Unit,
        ) {
            when (decision) {
                OwnerDecision.Proceed -> finish(signedIn, savePassword, onSignedIn)

                is OwnerDecision.AskDiscard -> {
                    pending = signedIn
                    form = form.copy(ownerDialog = decision.count)
                }
            }
        }

        private suspend fun finish(
            signedIn: PendingSignIn,
            savePassword: suspend (String, String) -> Unit,
            onSignedIn: (Me) -> Unit,
        ) {
            val email = form.email.trim()
            val password = form.password
            pending = null
            form = form.copy(password = "", ownerDialog = null)
            try {
                savePassword(email, password)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // No credential provider, or the user declined.
            }
            onSignedIn(signedIn.me)
        }

        /** The dialog's Delete and continue. */
        fun discardOtherUsersEntries(
            savePassword: suspend (String, String) -> Unit,
            onSignedIn: (Me) -> Unit,
        ) {
            val held = pending ?: return
            viewModelScope.launch {
                guard.discardAndProceed(held)
                finish(held, savePassword, onSignedIn)
            }
        }

        /** The dialog's Cancel: the held sign-in ends, the form stays. */
        fun keepOtherUsersEntries() {
            val held = pending ?: return
            pending = null
            form = form.copy(ownerDialog = null, password = "")
            viewModelScope.launch { guard.cancel(held) }
        }
    }
