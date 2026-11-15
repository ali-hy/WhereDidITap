// F-212 (S-1): the invitation flow's state, from the preview to the new account (password path).
package com.budmon.app.identity

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
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.ZoneId
import java.util.Currency
import java.util.Locale
import javax.inject.Inject

sealed interface InviteProblem {
    data class Expired(val at: Instant?) : InviteProblem

    data object Revoked : InviteProblem

    data class Used(val recent: Boolean) : InviteProblem

    data object Invalid : InviteProblem

    /** Anything else: shown through the error mapping, with Try again. */
    data class Failed(val error: ApiError) : InviteProblem
}

sealed interface InviteState {
    data object Checking : InviteState

    data class Join(val preview: InvitationPreview) : InviteState

    data class SetUp(val preview: InvitationPreview, val options: SignUpOptions) : InviteState

    /** [askInviter] is false for an owner (bootstrap) invitation: there is nobody to ask. */
    data class Problem(
        val problem: InviteProblem,
        val inviter: String?,
        val askInviter: Boolean = true,
    ) : InviteState
}

private const val MIN_PASSWORD = 12
private const val MAX_PASSWORD = 128
private const val MAX_NAME = 80

/** A field's error as a string resource, or null. */
typealias FieldError = Int?

@HiltViewModel
class InviteViewModel
@Inject
constructor(
    private val repository: AuthRepository,
) : ViewModel() {
    var state by mutableStateOf<InviteState>(InviteState.Checking)
        private set

    var name by mutableStateOf("")
    var password by mutableStateOf("")
    var currency by mutableStateOf<String?>(null)
    var timeZone by mutableStateOf<String?>(ZoneId.systemDefault().id)
    var language by mutableStateOf<String?>(null)
    var nameError by mutableStateOf<FieldError>(null)
    var passwordError by mutableStateOf<FieldError>(null)
    var currencyError by mutableStateOf<FieldError>(null)
    var timeZoneError by mutableStateOf<FieldError>(null)

    /** A message for a failure that has no field (rate limit, outage, no room). */
    var formError by mutableStateOf<UiText?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    private var token: String? = null
    private var preview: InvitationPreview? = null

    /** Whether a link was opened; false after the process was recreated. */
    val hasToken: Boolean
        get() = token != null

    /** Starts the flow for [value] from a clean form. The token lives only here, never in saved state. */
    fun open(value: String) {
        val same = token == value
        // The same token keeps its state, unless it ended in a problem.
        if (same && state !is InviteState.Problem) return
        if (!same) {
            token = value
            preview = null
            name = ""
            password = ""
            currency = null
            language = null
            nameError = null
            passwordError = null
            currencyError = null
            timeZoneError = null
            formError = null
        }
        check()
    }

    /** Back from set-up to the join screen. */
    fun backToJoin() {
        val p = preview ?: return
        password = ""
        formError = null
        state = InviteState.Join(p)
    }

    fun check() {
        val current = token ?: return
        state = InviteState.Checking
        viewModelScope.launch {
            try {
                val p = repository.previewInvitation(current)
                preview = p
                state = InviteState.Join(p)
            } catch (e: ApiException) {
                state = problemState(e.error)
            }
        }
    }

    fun usePassword() {
        val p = preview ?: return
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                val options = repository.signUpOptions()
                if (currency == null) currency = defaultCurrency(options.currencies)
                if (language == null) language = defaultLanguage(options.locales)
                state = InviteState.SetUp(p, options)
            } catch (e: ApiException) {
                state = problemState(e.error)
            } finally {
                busy = false
            }
        }
    }

    /** The problem with the inviter and origin the error carried; the preview's when it carried none. */
    private fun problemState(error: ApiError): InviteState.Problem {
        val data = (error as? ApiError.Defined)?.data
        val named = data?.get("inviterName")
        val inviter =
            if (named == null) preview?.inviterName else (named as? JsonPrimitive)?.takeIf { it.isString }?.content
        val origin = (data?.get("origin") as? JsonPrimitive)?.takeIf { it.isString }?.content ?: preview?.origin
        return InviteState.Problem(problemOf(error), inviter, askInviter = origin != "bootstrap")
    }

    private fun problemOf(error: ApiError): InviteProblem {
        if (error !is ApiError.Defined) return InviteProblem.Failed(error)
        return when (error.key) {
            "INVITATION_EXPIRED" ->
                InviteProblem.Expired(
                    (error.data?.get("expiredAt") as? JsonPrimitive)?.content?.let {
                        try {
                            Instant.parse(it)
                        } catch (_: java.time.format.DateTimeParseException) {
                            null
                        }
                    },
                )

            "INVITATION_REVOKED" -> InviteProblem.Revoked
            "INVITATION_USED" -> InviteProblem.Used((error.data?.get("recent") as? JsonPrimitive)?.content == "true")
            "INVITATION_INVALID" -> InviteProblem.Invalid
            else -> InviteProblem.Failed(error)
        }
    }

    private fun defaultCurrency(active: List<String>): String =
        try {
            Currency.getInstance(Locale.getDefault()).currencyCode.takeIf { it in active }
        } catch (_: IllegalArgumentException) {
            null
        } ?: "USD"

    private fun defaultLanguage(locales: List<String>): String {
        val tag = Locale.getDefault().toLanguageTag()
        return locales.firstOrNull { it == tag } ?: locales.firstOrNull { it == Locale.getDefault().language } ?: "en"
    }

    private fun validate(): Boolean {
        val nameLength = name.trim().codePointCount(0, name.trim().length)
        nameError =
            when {
                nameLength == 0 -> R.string.profile_name_required
                nameLength > MAX_NAME -> R.string.profile_name_too_long
                else -> null
            }
        val passwordLength = password.codePointCount(0, password.length)
        passwordError =
            when {
                passwordLength < MIN_PASSWORD -> R.string.password_too_short
                passwordLength > MAX_PASSWORD -> R.string.password_too_long
                else -> null
            }
        currencyError = if (currency == null) R.string.profile_currency_required else null
        timeZoneError = if (timeZone == null) R.string.profile_time_zone_required else null
        return nameError == null && passwordError == null && currencyError == null && timeZoneError == null
    }

    /** Creates the account; [onDone] gets the new user (null when it couldn't be read yet). */
    fun submit(onDone: (Me?) -> Unit) {
        val current = token ?: return
        formError = null
        if (busy || !validate()) return
        busy = true
        viewModelScope.launch {
            try {
                val me =
                    repository.acceptInvitation(
                        token = current,
                        email = preview?.email.orEmpty(),
                        displayName = name.trim(),
                        locale = language ?: "en",
                        timeZone = timeZone ?: ZoneId.systemDefault().id,
                        baseCurrency = currency ?: "USD",
                        password = password,
                    )
                password = ""
                onDone(me)
            } catch (e: ApiException) {
                fail(e.error)
            } finally {
                busy = false
            }
        }
    }

    private fun fail(error: ApiError) {
        if (error is ApiError.Defined) {
            when (error.key) {
                "PASSWORD_TOO_WEAK" -> {
                    passwordError =
                        when ((error.data?.get("reason") as? JsonPrimitive)?.content) {
                            "too_short" -> R.string.password_too_short
                            "too_long" -> R.string.password_too_long
                            "common" -> R.string.password_common
                            "contains_email" -> R.string.password_contains_email
                            else -> null
                        }
                    if (passwordError != null) return
                }

                "VALIDATION_FAILED" -> {
                    val issues = error.data?.get("issues") as? JsonArray
                    var mapped = false
                    for (issue in issues.orEmpty()) {
                        val fields = issue as? JsonObject
                        val path = (fields?.get("path") as? JsonArray)?.firstOrNull() as? JsonPrimitive
                        val code = (fields?.get("code") as? JsonPrimitive)?.content
                        when (path?.content) {
                            "displayName" ->
                                nameError =
                                    when (code) {
                                        "too_big" -> R.string.profile_name_too_long
                                        "too_small" -> R.string.profile_name_required
                                        else -> R.string.error_validation_form
                                    }

                            "baseCurrency" -> currencyError = R.string.profile_currency_required
                            "timeZone" -> timeZoneError = R.string.profile_time_zone_required
                            else -> continue
                        }
                        mapped = true
                    }
                    if (mapped) return
                }

                "USER_CAP_REACHED" -> {
                    val inviter = preview?.inviterName?.trim().orEmpty()
                    formError =
                        if (inviter.isEmpty()) {
                            UiText(R.string.invite_full_no_inviter)
                        } else {
                            UiText(R.string.invite_full, listOf(inviter))
                        }
                    return
                }

                "INVITATION_INVALID", "INVITATION_EXPIRED", "INVITATION_REVOKED", "INVITATION_USED" -> {
                    state = problemState(error)
                    return
                }
            }
        }
        formError = IdentityErrorMessages.forError(error, Operation.Create)
    }
}
