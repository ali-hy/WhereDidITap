// Identity screens (§8.2): the sign-in, the invitation link, join and set-up, the first-run home and its dialogs.
package com.budmon.app.identity.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.core.text.BidiFormatter
import com.budmon.app.BuildConfig
import com.budmon.app.R
import com.budmon.app.core.error.ErrorMessages
import com.budmon.app.core.error.Operation
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import com.budmon.app.identity.IdentityErrorMessages
import com.budmon.app.identity.InvitationLinkParser
import com.budmon.app.identity.InvitationPreview
import com.budmon.app.identity.InviteProblem
import com.budmon.app.identity.InviteState
import com.budmon.app.identity.InviteViewModel
import com.budmon.app.identity.Me
import com.budmon.app.identity.OwnerChoice
import com.budmon.app.identity.ParseResult
import com.budmon.app.identity.SignInFormState
import com.budmon.app.identity.SignInViewModel
import com.budmon.app.identity.SignOutState
import com.budmon.app.identity.SignOutViewModel
import com.budmon.app.identity.SignUpOptions
import com.budmon.app.identity.SignedOutReason
import com.budmon.app.ui.components.AppButton
import com.budmon.app.ui.components.AppButtonVariant
import com.budmon.app.ui.components.AppPasswordField
import com.budmon.app.ui.components.AppTextField
import com.budmon.app.ui.components.Wordmark
import com.budmon.app.ui.theme.AppColors
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
private fun Page(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 24.dp),
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

/** The signed-out start: the password form, then the way in with an invitation link. */
@Composable
fun SignInScreen(
    reason: SignedOutReason,
    isOnline: Boolean,
    form: SignInFormState,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onHaveLink: () -> Unit,
    onPrivacy: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Page(modifier) {
        Heading(stringResource(R.string.signin_title))
        if (reason == SignedOutReason.Ended) Text(stringResource(R.string.signin_session_ended))
        if (!isOnline) Text(stringResource(R.string.signin_offline), color = MaterialTheme.colorScheme.error)
        form.formError?.let {
            Text(
                uiString(it),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        AppTextField(
            value = form.email,
            onValueChange = onEmailChange,
            label = stringResource(R.string.signin_email),
            error = form.emailError?.let { stringResource(it) },
            keyboardType = KeyboardType.Email,
            readOnly = form.busy,
            contentType = ContentType.EmailAddress,
        )
        AppPasswordField(
            value = form.password,
            onValueChange = onPasswordChange,
            label = stringResource(R.string.signin_password),
            error = form.passwordError?.let { stringResource(it) },
            keyboardActions = KeyboardActions(onDone = { onSubmit() }),
            imeAction = ImeAction.Done,
            readOnly = form.busy,
            contentType = ContentType.Password,
        )
        AppButton(stringResource(R.string.signin_submit), onSubmit, Modifier.fillMaxWidth(), busy = form.busy)
        Text(stringResource(R.string.signin_invite_only), color = MaterialTheme.colorScheme.onSurfaceVariant)
        AppButton(stringResource(R.string.signin_have_link), onHaveLink, Modifier.fillMaxWidth(), AppButtonVariant.Secondary)
        AppButton(stringResource(R.string.signin_privacy), onPrivacy, variant = AppButtonVariant.Tertiary)
    }
}

/** The invitation link: type or paste it; Continue is enabled when there is text. */
@Composable
fun InvitationLinkScreen(
    text: String,
    @StringRes error: Int?,
    onTextChange: (String) -> Unit,
    onPaste: () -> Unit,
    onContinue: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Page(modifier) {
        Heading(stringResource(R.string.invite_link_title))
        Text(stringResource(R.string.invite_link_instruction), color = MaterialTheme.colorScheme.onSurfaceVariant)
        AppTextField(
            value = text,
            onValueChange = onTextChange,
            label = stringResource(R.string.invite_link_field),
            error = error?.let { stringResource(it) },
        )
        AppButton(stringResource(R.string.invite_link_paste), onPaste, Modifier.fillMaxWidth(), AppButtonVariant.Secondary)
        AppButton(stringResource(R.string.invite_link_continue), onContinue, Modifier.fillMaxWidth(), enabled = text.isNotBlank())
        AppButton(stringResource(R.string.invite_link_back), onBack, variant = AppButtonVariant.Tertiary)
    }
}

/** Holds the link screen's state; the pasted text can hold the token, so it is never saved. */
@Composable
fun InvitationLinkRoute(
    apiBaseUrl: HttpUrl,
    isOnline: Boolean,
    onToken: (String) -> Unit,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    // The emulator reaches the host's server at 10.0.2.2, while invitation links name localhost.
    val aliases = if (BuildConfig.DEBUG && apiBaseUrl.host == "10.0.2.2") setOf("localhost", "127.0.0.1") else emptySet()
    val clipboard = LocalClipboardManager.current
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<Int?>(null) }
    InvitationLinkScreen(
        text = text,
        error = error,
        onTextChange = {
            text = it
            error = null
        },
        onPaste = { clipboard.getText()?.text?.let { text = it } },
        onContinue = {
            error =
                if (!isOnline) {
                    R.string.invite_link_offline
                } else {
                    when (val parsed = InvitationLinkParser.parse(text, apiBaseUrl, aliases)) {
                        is ParseResult.Token -> {
                            onToken(parsed.value)
                            null
                        }

                        ParseResult.OtherServer -> R.string.invite_link_other_server
                        ParseResult.NotAnInvitation -> R.string.invite_link_not_invitation
                    }
                }
        },
        onBack = onBack,
    )
}

/** Checking the invitation. */
@Composable
fun InviteCheckingScreen(modifier: Modifier = Modifier) {
    Page(modifier) {
        Heading(stringResource(R.string.invite_checking))
        CircularProgressIndicator()
    }
}

/** The invitation's preview, with the way into set-up. */
@Composable
fun JoinScreen(
    preview: InvitationPreview,
    busy: Boolean,
    onUsePassword: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Page(modifier) {
        Heading(stringResource(R.string.invite_title))
        val line =
            if (preview.origin == "bootstrap") {
                stringResource(R.string.invite_from_owner, isolated(preview.email))
            } else if (preview.inviterName.isNullOrBlank()) {
                stringResource(R.string.invite_for_email, isolated(preview.email))
            } else {
                stringResource(R.string.invite_from, isolated(preview.inviterName.trim()), isolated(preview.email))
            }
        Text(line)
        Text(
            stringResource(R.string.invite_expires, formatDate(preview.expiresAt)),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        AppButton(
            stringResource(R.string.invite_use_password),
            onUsePassword,
            Modifier.fillMaxWidth(),
            AppButtonVariant.Secondary,
            busy = busy,
        )
    }
}

/** What the set-up form shows. */
data class SetUpFormState(
    val name: String,
    val password: String,
    val currency: String?,
    val timeZone: String?,
    val language: String?,
    @StringRes val nameError: Int?,
    @StringRes val passwordError: Int?,
    @StringRes val currencyError: Int?,
    @StringRes val timeZoneError: Int?,
    val formError: UiText?,
    val busy: Boolean,
)

/** The invitation's problem: its text, and Sign in or Try again. */
@Composable
fun InviteProblemScreen(
    problem: InviteProblem,
    inviter: String?,
    origin: String?,
    onRetry: () -> Unit,
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Page(modifier) {
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
        val name = inviter?.trim().orEmpty()
        // Whom to ask: for expired, revoked and used (not the recent "ready"); never for an owner invitation.
        val asks =
            problem is InviteProblem.Expired || problem == InviteProblem.Revoked ||
                (problem is InviteProblem.Used && !problem.recent)
        if (origin != "bootstrap" && asks) {
            val ask =
                if (name.isEmpty()) {
                    stringResource(R.string.invite_problem_ask_anyone)
                } else {
                    stringResource(R.string.invite_problem_ask_inviter, isolated(name))
                }
            Text(ask, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (problem is InviteProblem.Failed) {
            AppButton(stringResource(R.string.error_fallback_retry), onRetry, Modifier.fillMaxWidth())
        } else {
            AppButton(stringResource(R.string.signin_title), onSignIn, Modifier.fillMaxWidth())
        }
    }
}

/** The set-up form (password path). */
@Composable
fun SetUpAccountScreen(
    email: String,
    options: SignUpOptions,
    form: SetUpFormState,
    onNameChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onCurrencyChange: (String) -> Unit,
    onTimeZoneChange: (String) -> Unit,
    onLanguageChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onPrivacy: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val locale = Locale.getDefault()
    val zones = remember { ZoneId.getAvailableZoneIds().sorted() }
    Page(modifier) {
        Heading(stringResource(R.string.setup_title))
        Text(isolated(email), color = MaterialTheme.colorScheme.onSurfaceVariant)
        form.formError?.let { Text(uiString(it), color = MaterialTheme.colorScheme.error) }
        AppTextField(
            value = form.name,
            onValueChange = onNameChange,
            label = stringResource(R.string.setup_name),
            error = form.nameError?.let { stringResource(it) },
        )
        AppPasswordField(
            value = form.password,
            onValueChange = onPasswordChange,
            label = stringResource(R.string.setup_password),
            hint = stringResource(R.string.setup_password_hint),
            error = form.passwordError?.let { stringResource(it) },
        )
        PickerField(
            label = stringResource(R.string.setup_currency),
            hint = stringResource(R.string.setup_currency_hint),
            options =
            options.currencies.map { code ->
                code to "$code – ${runCatching { java.util.Currency.getInstance(code).getDisplayName(locale) }.getOrDefault(code)}"
            },
            selected = form.currency,
            error = form.currencyError?.let { stringResource(it) },
            onSelect = onCurrencyChange,
        )
        PickerField(
            label = stringResource(R.string.setup_time_zone),
            hint = null,
            options = zones.map { it to it },
            selected = form.timeZone,
            error = form.timeZoneError?.let { stringResource(it) },
            onSelect = onTimeZoneChange,
        )
        PickerField(
            label = stringResource(R.string.setup_language),
            hint = null,
            options =
            options.locales.map {
                it to Locale.forLanguageTag(it).getDisplayName(Locale.forLanguageTag(it))
            },
            selected = form.language,
            error = null,
            onSelect = onLanguageChange,
        )
        // The notice opens on the server's origin in a Custom Tab.
        val linkStyle = SpanStyle(color = AppColors.extra.accentFg, textDecoration = TextDecoration.Underline)
        val privacy =
            buildAnnotatedString {
                withLink(LinkAnnotation.Clickable("privacy", TextLinkStyles(linkStyle)) { onPrivacy() }) {
                    append(stringResource(R.string.setup_privacy))
                }
            }
        Text(privacy, style = MaterialTheme.typography.bodySmall, modifier = Modifier.heightIn(min = 48.dp))
        AppButton(stringResource(R.string.setup_submit), onSubmit, Modifier.fillMaxWidth(), busy = form.busy)
    }
}

/** Holds the invitation flow: one screen per [InviteState], from the view model. */
@Composable
fun InviteFlowRoute(
    viewModel: InviteViewModel,
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    onSignedUp: (Me) -> Unit,
    onPrivacy: () -> Unit,
) {
    // Back on set-up returns to join; elsewhere it leaves the screen.
    BackHandler {
        if (viewModel.state is InviteState.SetUp) viewModel.backToJoin() else onBack()
    }
    // After the process was recreated the token is gone: back to the link screen.
    LaunchedEffect(Unit) { if (!viewModel.hasToken) onBack() }
    viewModel.ownerDialog?.let { count ->
        OutboxOwnerDialog(
            count,
            busy = viewModel.ownerBusy,
            onDelete = { viewModel.discardOtherUsersEntries(onSignedUp) },
            onCancel = viewModel::keepOtherUsersEntries,
        )
    }
    when (val state = viewModel.state) {
        InviteState.Checking -> {
            InviteCheckingScreen()
        }

        is InviteState.Join -> {
            JoinScreen(state.preview, viewModel.busy, onUsePassword = viewModel::usePassword)
        }

        is InviteState.SetUp -> {
            SetUpAccountScreen(
                email = state.preview.email,
                options = state.options,
                form =
                SetUpFormState(
                    name = viewModel.name,
                    password = viewModel.password,
                    currency = viewModel.currency,
                    timeZone = viewModel.timeZone,
                    language = viewModel.language,
                    nameError = viewModel.nameError,
                    passwordError = viewModel.passwordError,
                    currencyError = viewModel.currencyError,
                    timeZoneError = viewModel.timeZoneError,
                    formError = viewModel.formError,
                    busy = viewModel.busy,
                ),
                onNameChange = { viewModel.name = it },
                onPasswordChange = { viewModel.password = it },
                onCurrencyChange = { viewModel.currency = it },
                onTimeZoneChange = { viewModel.timeZone = it },
                onLanguageChange = { viewModel.language = it },
                onSubmit = { viewModel.submit(onSignedUp) },
                onPrivacy = onPrivacy,
            )
        }

        is InviteState.Problem -> {
            InviteProblemScreen(
                state.problem,
                state.inviter,
                state.origin,
                onRetry = viewModel::check,
                onSignIn = onSignIn,
            )
        }
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

/** The initials of the first and last word of [name]. */
private fun initialsOf(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val letters = listOfNotNull(words.firstOrNull(), words.takeIf { it.size > 1 }?.last()).map { it.codePointAt(0) }
    return letters.joinToString("") { String(Character.toChars(it)) }.uppercase()
}

/** The first-run home: an empty state with the user's name, and the account menu. */
@Composable
fun HomeFirstRunScreen(
    me: Me,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxSize()) {
        var menuOpen by remember { mutableStateOf(false) }
        val account = stringResource(R.string.menu_account)
        Box(Modifier.align(Alignment.TopEnd).padding(8.dp)) {
            IconButton(onClick = { menuOpen = true }, modifier = Modifier.semantics { contentDescription = account }) {
                Text(initialsOf(me.displayName), style = MaterialTheme.typography.labelLarge)
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.menu_sign_out)) },
                    onClick = {
                        menuOpen = false
                        onSignOut()
                    },
                )
            }
        }
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier.size(48.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painterResource(R.drawable.lucide_wallet),
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
            Text(
                stringResource(R.string.home_welcome, isolated(me.displayName)),
                style = MaterialTheme.typography.titleLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 12.dp).semantics { heading() },
            )
            Text(
                stringResource(R.string.home_first_run),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** The home with its sign-out flow: the unsynced-entries question and a failure message. */
@Composable
fun HomeRoute(
    me: Me,
    isOnline: Boolean,
    viewModel: SignOutViewModel,
    onSignedOut: () -> Unit,
) {
    HomeFirstRunScreen(me, onSignOut = { viewModel.requestSignOut(onSignedOut) })
    when (val state = viewModel.state) {
        SignOutState.Idle -> {}

        SignOutState.Busy -> {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }

        is SignOutState.Confirming -> {
            SignOutDialog(
                unsynced = state.unsynced,
                isOnline = isOnline,
                onSyncNow = viewModel::syncNow,
                onSignOutAnyway = { viewModel.signOutAnyway(onSignedOut) },
                onCancel = viewModel::dismiss,
            )
        }

        is SignOutState.Failed -> {
            AlertDialog(
                onDismissRequest = viewModel::dismiss,
                text = { Text(uiString(state.message)) },
                confirmButton = {
                    TextButton(onClick = { viewModel.requestSignOut(onSignedOut) }) { Text(stringResource(R.string.menu_sign_out)) }
                },
                dismissButton = { TextButton(onClick = viewModel::dismiss) { Text(stringResource(R.string.signout_cancel)) } },
            )
        }
    }
}

/** Another user's unsynced entries are on this phone: delete them to continue, or cancel. */
@Composable
fun OutboxOwnerDialog(
    count: Int,
    onDelete: () -> Unit,
    onCancel: () -> Unit,
    busy: OwnerChoice? = null,
) {
    // Taps are ignored while an action runs; the chosen button shows a spinner.
    AlertDialog(
        onDismissRequest = { if (busy == null) onCancel() },
        text = { Text(pluralStringResource(R.plurals.outbox_other_user, count, count)) },
        confirmButton = {
            TextButton(onClick = { if (busy == null) onDelete() }) {
                if (busy == OwnerChoice.Delete) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Text(stringResource(R.string.outbox_delete_continue))
            }
        },
        dismissButton = {
            TextButton(onClick = { if (busy == null) onCancel() }) {
                if (busy == OwnerChoice.Cancel) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Text(stringResource(R.string.outbox_cancel))
            }
        },
    )
}

/** Signing out with [unsynced] entries still on this phone. Sync now needs a connection. */
@Composable
fun SignOutDialog(
    unsynced: Int,
    isOnline: Boolean,
    onSyncNow: () -> Unit,
    onSignOutAnyway: () -> Unit,
    onCancel: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onCancel,
        text = { Text(pluralStringResource(R.plurals.signout_unsynced, unsynced, unsynced)) },
        confirmButton = {
            Column(horizontalAlignment = Alignment.End) {
                if (isOnline) TextButton(onClick = onSyncNow) { Text(stringResource(R.string.signout_sync_now)) }
                TextButton(onClick = onSignOutAnyway) { Text(stringResource(R.string.signout_anyway)) }
            }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(R.string.signout_cancel)) } },
    )
}

/** The sign-in route: the form from [viewModel], and the other-user dialog. */
@Composable
fun SignInRoute(
    viewModel: SignInViewModel,
    reason: SignedOutReason,
    isOnline: Boolean,
    savePassword: suspend (String, String) -> Unit,
    onSignedIn: (Me) -> Unit,
    onHaveLink: () -> Unit,
    onPrivacy: () -> Unit,
) {
    val form = viewModel.form
    SignInScreen(
        reason = reason,
        isOnline = isOnline,
        form = form,
        onEmailChange = viewModel::onEmailChange,
        onPasswordChange = viewModel::onPasswordChange,
        onSubmit = { viewModel.submit(isOnline, savePassword, onSignedIn) },
        onHaveLink = onHaveLink,
        onPrivacy = onPrivacy,
    )
    form.ownerDialog?.let { count ->
        OutboxOwnerDialog(
            count,
            busy = form.ownerBusy,
            onDelete = { viewModel.discardOtherUsersEntries(savePassword, onSignedIn) },
            onCancel = viewModel::keepOtherUsersEntries,
        )
    }
}

@Composable
fun SessionLoadingScreen(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
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
