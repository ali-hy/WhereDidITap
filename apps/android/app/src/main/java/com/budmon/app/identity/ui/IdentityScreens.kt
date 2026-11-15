// S-1 screens (§8.2): the signed-out start, the invitation link, join and set-up, and the first-run home.
package com.budmon.app.identity.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.text.BidiFormatter
import com.budmon.app.R
import com.budmon.app.core.error.ErrorMessages
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import com.budmon.app.identity.InvitationLinkParser
import com.budmon.app.identity.InviteProblem
import com.budmon.app.identity.InviteState
import com.budmon.app.identity.InviteViewModel
import com.budmon.app.identity.Me
import com.budmon.app.identity.IdentityErrorMessages
import com.budmon.app.identity.ParseResult
import com.budmon.app.identity.SignedOutReason
import com.budmon.app.core.error.Operation
import com.budmon.app.ui.components.AppButton
import com.budmon.app.ui.components.AppButtonVariant
import com.budmon.app.ui.components.AppPasswordField
import com.budmon.app.ui.components.AppTextField
import com.budmon.app.ui.components.Wordmark
import okhttp3.HttpUrl
import java.text.DateFormat
import java.time.Instant
import java.time.ZoneId
import java.util.Date
import java.util.Locale
import java.util.TimeZone

@Composable
private fun uiString(text: UiText): String =
    if (text.quantity != null) {
        pluralStringResource(text.resId, text.quantity!!, *text.args.toTypedArray())
    } else {
        stringResource(text.resId, *text.args.toTypedArray())
    }

@Composable
private fun Heading(text: String) {
    Text(text, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
}

@Composable
private fun Page(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Wordmark()
        content()
    }
}

/** Wraps an email or name so it reads left to right inside a sentence of any direction. */
@Composable
private fun isolated(value: String): String = BidiFormatter.getInstance().unicodeWrap(value)

private fun formatDate(at: Instant?): String =
    if (at == null) {
        ""
    } else {
        DateFormat.getDateInstance(DateFormat.LONG).apply { timeZone = TimeZone.getTimeZone(ZoneId.systemDefault()) }.format(Date.from(at))
    }

/** The signed-out start; until S-3 only the invitation link. */
@Composable
fun SignInScreen(
    reason: SignedOutReason,
    isOnline: Boolean,
    onHaveLink: () -> Unit,
) {
    Page {
        Heading(stringResource(R.string.signin_title))
        if (reason == SignedOutReason.Ended) Text(stringResource(R.string.signin_session_ended))
        Text(stringResource(R.string.signin_invite_only), color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!isOnline) Text(stringResource(R.string.signin_offline), color = MaterialTheme.colorScheme.error)
        AppButton(stringResource(R.string.signin_have_link), onHaveLink, Modifier.fillMaxWidth(), AppButtonVariant.Secondary)
    }
}

/** Paste (read only on tap) or type the invitation link. */
@Composable
fun InvitationLinkScreen(
    apiBaseUrl: HttpUrl,
    isOnline: Boolean,
    onToken: (String) -> Unit,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val clipboard = LocalClipboardManager.current
    // Not saved: the pasted link holds the invitation token.
    var text by remember { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf<Int?>(null) }
    fun open() {
        error =
            if (!isOnline) {
                R.string.invite_link_offline
            } else {
                when (val parsed = InvitationLinkParser.parse(text, apiBaseUrl)) {
                    is ParseResult.Token -> {
                        onToken(parsed.value)
                        null
                    }

                    ParseResult.OtherServer -> R.string.invite_link_other_server
                    ParseResult.NotAnInvitation -> R.string.invite_link_not_invitation
                }
            }
    }
    Page {
        Heading(stringResource(R.string.invite_link_title))
        AppTextField(
            value = text,
            onValueChange = {
                text = it
                error = null
            },
            label = stringResource(R.string.invite_link_field),
            error = error?.let { stringResource(it) },
        )
        AppButton(
            stringResource(R.string.invite_link_paste),
            { clipboard.getText()?.text?.let { text = it } },
            Modifier.fillMaxWidth(),
            AppButtonVariant.Secondary,
        )
        AppButton(stringResource(R.string.invite_link_open), ::open, Modifier.fillMaxWidth(), enabled = text.isNotBlank())
    }
}

/** Join (preview) and set-up, for one invitation token. */
@Composable
fun InviteFlowScreen(
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    onSignedUp: (Me?) -> Unit,
    viewModel: InviteViewModel,
) {
    // Back on set-up returns to join; elsewhere it leaves the screen.
    BackHandler {
        if (viewModel.state is InviteState.SetUp) viewModel.backToJoin() else onBack()
    }
    // After the process was recreated the token is gone: back to the link screen.
    LaunchedEffect(Unit) { if (!viewModel.hasToken) onBack() }
    when (val state = viewModel.state) {
        InviteState.Checking -> {
            Page {
                Heading(stringResource(R.string.invite_checking))
                CircularProgressIndicator()
            }
        }

        is InviteState.Join -> {
            val p = state.preview
            Page {
                Heading(stringResource(R.string.invite_title))
                val line =
                    if (p.origin == "bootstrap") {
                        stringResource(R.string.invite_from_owner, isolated(p.email))
                    } else {
                        stringResource(R.string.invite_from, isolated(p.inviterName.orEmpty()), isolated(p.email))
                    }
                Text(line)
                Text(
                    stringResource(R.string.invite_expires, formatDate(p.expiresAt)),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                AppButton(stringResource(R.string.invite_use_password), viewModel::usePassword, Modifier.fillMaxWidth(), AppButtonVariant.Secondary)
            }
        }

        is InviteState.SetUp -> {
            SetUpAccountScreen(state, viewModel, onSignedUp)
        }

        is InviteState.Problem -> {
            ProblemScreen(state, onRetry = viewModel::check, onSignIn = onSignIn)
        }
    }
}

@Composable
private fun ProblemScreen(
    state: InviteState.Problem,
    onRetry: () -> Unit,
    onSignIn: () -> Unit,
) {
    val problem = state.problem
    Page {
        Heading(stringResource(R.string.invite_problem_title))
        val text =
            when (problem) {
                is InviteProblem.Expired -> stringResource(R.string.invite_problem_expired, formatDate(problem.at))
                InviteProblem.Revoked -> stringResource(R.string.invite_problem_revoked)
                is InviteProblem.Used ->
                    stringResource(if (problem.recent) R.string.invite_problem_ready else R.string.invite_problem_used)

                InviteProblem.Invalid -> stringResource(R.string.invite_problem_invalid)
                is InviteProblem.Failed -> uiString(IdentityErrorMessages.forError(problem.error, Operation.Read))
            }
        Text(text)
        val inviter = state.inviter
        if ((problem is InviteProblem.Expired || problem == InviteProblem.Revoked) && !inviter.isNullOrEmpty()) {
            Text(stringResource(R.string.invite_problem_ask_inviter, isolated(inviter)), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (problem is InviteProblem.Failed) {
            AppButton(stringResource(R.string.error_fallback_retry), onRetry, Modifier.fillMaxWidth())
        } else {
            AppButton(stringResource(R.string.signin_title), onSignIn, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun SetUpAccountScreen(
    state: InviteState.SetUp,
    vm: InviteViewModel,
    onSignedUp: (Me?) -> Unit,
) {
    val locale = Locale.getDefault()
    val zones = remember { TimeZone.getAvailableIDs().toList().sorted() }
    Page {
        Heading(stringResource(R.string.setup_title))
        Text(isolated(state.preview.email), color = MaterialTheme.colorScheme.onSurfaceVariant)
        vm.formError?.let { Text(uiString(it), color = MaterialTheme.colorScheme.error) }
        AppTextField(
            value = vm.name,
            onValueChange = { vm.name = it },
            label = stringResource(R.string.setup_name),
            error = vm.nameError?.let { stringResource(it) },
        )
        AppPasswordField(
            value = vm.password,
            onValueChange = { vm.password = it },
            label = stringResource(R.string.setup_password),
            hint = stringResource(R.string.setup_password_hint),
            error = vm.passwordError?.let { stringResource(it) },
        )
        PickerField(
            label = stringResource(R.string.setup_currency),
            hint = stringResource(R.string.setup_currency_hint),
            options =
            state.options.currencies.map { code ->
                code to "$code – ${runCatching { java.util.Currency.getInstance(code).getDisplayName(locale) }.getOrDefault(code)}"
            },
            selected = vm.currency,
            error = vm.currencyError?.let { stringResource(it) },
            onSelect = { vm.currency = it },
        )
        PickerField(
            label = stringResource(R.string.setup_time_zone),
            hint = null,
            options = zones.map { it to it },
            selected = vm.timeZone,
            error = vm.timeZoneError?.let { stringResource(it) },
            onSelect = { vm.timeZone = it },
        )
        PickerField(
            label = stringResource(R.string.setup_language),
            hint = null,
            options = state.options.locales.map { it to Locale.forLanguageTag(it).getDisplayName(Locale.forLanguageTag(it)) },
            selected = vm.language,
            error = null,
            onSelect = { vm.language = it },
        )
        Text(stringResource(R.string.setup_privacy), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        AppButton(
            stringResource(R.string.setup_submit),
            { vm.submit(onSignedUp) },
            Modifier.fillMaxWidth(),
            busy = vm.busy,
        )
    }
}

/** A read-only field that opens a searchable bottom sheet of [options] (value to label). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PickerField(
    label: String,
    hint: String?,
    options: List<Pair<String, String>>,
    selected: String?,
    error: String?,
    onSelect: (String) -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val shown = options.firstOrNull { it.first == selected }?.second ?: selected.orEmpty()
    Box {
        AppTextField(
            value = shown,
            onValueChange = {},
            label = label,
            hint = hint,
            error = error,
            readOnly = true,
        )
        // Covers the field, so a tap anywhere on it opens the sheet.
        Box(Modifier.matchParentSize().clickable { open = true })
    }
    if (open) {
        ModalBottomSheet(onDismissRequest = {
            open = false
            query = ""
        }) {
            Column(Modifier.padding(horizontal = 16.dp)) {
                AppTextField(value = query, onValueChange = { query = it }, label = stringResource(R.string.setup_search))
                LazyColumn {
                    items(options.filter { it.second.contains(query.trim(), ignoreCase = true) }, key = { it.first }) { (value, text) ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 48.dp)
                                .clickable {
                                    onSelect(value)
                                    open = false
                                    query = ""
                                },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(text, modifier = Modifier.weight(1f))
                            if (value == selected) {
                                Icon(painterResource(R.drawable.lucide_check), contentDescription = null, modifier = Modifier.size(20.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** The first-run home: an empty state with the user's name. */
@Composable
fun HomeFirstRunScreen(me: Me) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(painterResource(R.drawable.lucide_wallet), contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Text(
            stringResource(R.string.home_welcome, isolated(me.displayName)),
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 12.dp).semantics { heading() },
        )
        Text(stringResource(R.string.home_first_run), color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

@Composable
fun SessionLoadingScreen() {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Wordmark()
    }
}

/**
 * Shown in place of a screen's content while the session's `me` couldn't be loaded. Try again follows
 * the busy rule: a spinner while [retrying], still enabled, taps ignored.
 */
@Composable
fun SessionNotLoaded(
    isOnline: Boolean,
    lastError: ApiError?,
    retrying: Boolean,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val message =
        when {
            !isOnline -> stringResource(R.string.offline_nothing_loaded)
            lastError == null || lastError is ApiError.Network || lastError is ApiError.Timeout || lastError is ApiError.Unavailable ->
                stringResource(R.string.error_unavailable)

            else -> uiString(ErrorMessages.forError(lastError, Operation.Read))
        }
    Column(
        modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, textAlign = TextAlign.Center, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        AppButton(stringResource(R.string.error_fallback_retry), onRetry, Modifier.padding(top = 16.dp), busy = retrying)
    }
}
