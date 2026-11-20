// S-4's screens (§8.2): the second step of a sign-in, the step-up sheet, the two-step setup and its
// recovery codes, and the two-step section of Sign-in & security.
package com.budmon.app.identity.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.PersistableBundle
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SheetValue
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import com.budmon.app.R
import com.budmon.app.identity.ConfirmFactor
import com.budmon.app.identity.ConfirmFormState
import com.budmon.app.identity.ConfirmationCoordinator
import com.budmon.app.identity.Me
import com.budmon.app.identity.SecurityViewModel
import com.budmon.app.identity.SetupStep
import com.budmon.app.identity.TurnOffFormState
import com.budmon.app.identity.TwoStepEndReason
import com.budmon.app.identity.TwoStepFormState
import com.budmon.app.identity.TwoStepSetupState
import com.budmon.app.identity.TwoStepSetupViewModel
import com.budmon.app.identity.TwoStepViewModel
import com.budmon.app.ui.components.AppButton
import com.budmon.app.ui.components.AppButtonVariant
import com.budmon.app.ui.components.AppPasswordField
import com.budmon.app.ui.components.AppTextField
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

private const val QR_SIZE_DP = 224
private const val SENSITIVE_EXTRA = "android.content.extra.IS_SENSITIVE"

/** Keeps the screen out of screenshots and the recent-apps thumbnail while it is shown. */
@Composable
fun SecureWindow() {
    val context = LocalContext.current
    DisposableEffect(context) {
        val window = context.findActivity()?.window
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

private tailrec fun Context.findActivity(): Activity? =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }

/** Moves focus to the field it is applied to, on first composition and whenever [keys] change. */
@Composable
private fun rememberFieldFocus(vararg keys: Any?): FocusRequester {
    val requester = remember { FocusRequester() }
    LaunchedEffect(*keys) {
        try {
            requester.requestFocus()
        } catch (_: IllegalStateException) {
            // Not on screen yet.
        }
    }
    return requester
}

@Composable
private fun ErrorLine(text: String) {
    Text(
        text,
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

// ---- Sign-in: the second step (F-209) ----

/** The code field and its alternatives; the field takes focus, and again after a wrong code. */
@Composable
fun TwoStepScreen(
    form: TwoStepFormState,
    onValueChange: (String) -> Unit,
    onToggleRecovery: () -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val focus = rememberFieldFocus(form.error, form.useRecovery)
    Page(modifier) {
        Heading(stringResource(R.string.twostep_title))
        Text(stringResource(R.string.twostep_prompt))
        form.formError?.let { ErrorLine(uiString(it)) }
        if (form.showRecoveryHint) Text(stringResource(R.string.twostep_limit_recovery))
        AppTextField(
            value = form.value,
            onValueChange = onValueChange,
            label = stringResource(if (form.useRecovery) R.string.twostep_recovery else R.string.twostep_code),
            error = form.error?.let { stringResource(it) },
            keyboardType = if (form.useRecovery) KeyboardType.Text else KeyboardType.NumberPassword,
            keyboardActions = KeyboardActions(onDone = { onSubmit() }),
            imeAction = ImeAction.Done,
            readOnly = form.busy,
            fieldModifier = Modifier.focusRequester(focus),
        )
        AppButton(
            stringResource(if (form.useRecovery) R.string.twostep_use_code else R.string.twostep_use_recovery),
            onToggleRecovery,
            variant = AppButtonVariant.Tertiary,
        )
        AppButton(stringResource(R.string.twostep_verify), onSubmit, Modifier.fillMaxWidth(), busy = form.busy)
        Text(stringResource(R.string.twostep_lost_help), style = MaterialTheme.typography.titleSmall)
        Text(stringResource(R.string.twostep_lost_help_body), color = MaterialTheme.colorScheme.onSurfaceVariant)
        AppButton(stringResource(R.string.twostep_back), onBack, variant = AppButtonVariant.Tertiary)
    }
}

/** The two-step screen over [viewModel], with the other-user dialog. */
@Composable
fun TwoStepRoute(
    viewModel: TwoStepViewModel,
    savePassword: suspend (String, String) -> Unit,
    onSignedIn: (Me) -> Unit,
    onEnded: (TwoStepEndReason) -> Unit,
    onBack: () -> Unit,
) {
    val form = viewModel.form
    TwoStepScreen(
        form = form,
        onValueChange = viewModel::onValueChange,
        onToggleRecovery = viewModel::toggleRecovery,
        onSubmit = { viewModel.submit(savePassword, onSignedIn, onEnded) },
        onBack = onBack,
    )
    form.ownerDialog?.let { count ->
        OutboxOwnerDialog(
            count,
            onDelete = { viewModel.discardOtherUsersEntries(savePassword, onSignedIn, onEnded) },
            onCancel = { viewModel.keepOtherUsersEntries(onBack) },
        )
    }
}

// ---- Step-up (F-216) ----

/** "Confirm it's you": a password or a code (or recovery code); dismissing the sheet cancels. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfirmItsYouSheet(
    factor: ConfirmFactor,
    form: ConfirmFormState,
    onValueChange: (String) -> Unit,
    onToggleRecovery: () -> Unit,
    onSubmit: () -> Unit,
    onCancel: () -> Unit,
) {
    val focus = rememberFieldFocus(form.error, form.useRecovery)
    val sheetState =
        rememberModalBottomSheetState(confirmValueChange = { it != SheetValue.Hidden || !form.busy })
    ModalBottomSheet(onDismissRequest = onCancel, sheetState = sheetState) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Heading(stringResource(R.string.confirm_title))
            form.formError?.let { ErrorLine(uiString(it)) }
            if (factor == ConfirmFactor.Password) {
                AppPasswordField(
                    value = form.value,
                    onValueChange = onValueChange,
                    label = stringResource(R.string.confirm_password),
                    error = form.error?.let { stringResource(it) },
                    keyboardActions = KeyboardActions(onDone = { onSubmit() }),
                    readOnly = form.busy,
                )
            } else {
                AppTextField(
                    value = form.value,
                    onValueChange = onValueChange,
                    label = stringResource(if (form.useRecovery) R.string.twostep_recovery else R.string.twostep_code),
                    error = form.error?.let { stringResource(it) },
                    keyboardType = if (form.useRecovery) KeyboardType.Text else KeyboardType.NumberPassword,
                    keyboardActions = KeyboardActions(onDone = { onSubmit() }),
                    imeAction = ImeAction.Done,
                    readOnly = form.busy,
                    fieldModifier = Modifier.focusRequester(focus),
                )
                AppButton(
                    stringResource(if (form.useRecovery) R.string.twostep_use_code else R.string.twostep_use_recovery),
                    onToggleRecovery,
                    variant = AppButtonVariant.Tertiary,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AppButton(stringResource(R.string.confirm_submit), onSubmit, busy = form.busy)
                AppButton(stringResource(R.string.confirm_cancel), onCancel, variant = AppButtonVariant.Secondary, enabled = !form.busy)
            }
        }
    }
}

/** Shows the step-up sheet while the coordinator has a request. */
@Composable
fun ConfirmItsYouHost(coordinator: ConfirmationCoordinator) {
    val factor by coordinator.request.collectAsState()
    val form by coordinator.form.collectAsState()
    factor?.let {
        ConfirmItsYouSheet(
            factor = it,
            form = form,
            onValueChange = coordinator::onValueChange,
            onToggleRecovery = coordinator::toggleRecovery,
            onSubmit = { coordinator.submit() },
            onCancel = coordinator::cancel,
        )
    }
}

// ---- Setup and recovery codes (F-215) ----

/** The module matrix of [text] as a black-on-white bitmap. */
private fun qrBitmap(text: String): Bitmap {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 2))
    val width = matrix.width
    val height = matrix.height
    val pixels = IntArray(width * height) { i -> if (matrix.get(i % width, i / width)) Color.BLACK else Color.WHITE }
    return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
}

/** The setup steps: a spinner, the QR code and key with the code field, or the timed-out message. */
@Composable
fun TwoStepSetupScreen(
    state: TwoStepSetupState,
    onCodeChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onOpenInApp: () -> Unit,
    onCopyKey: () -> Unit,
    onStartAgain: () -> Unit,
    replace: Boolean = false,
    modifier: Modifier = Modifier,
) {
    Page(modifier) {
        Heading(stringResource(if (replace) R.string.twostep_replace else R.string.twostep_setup_title))
        when (state.step) {
            SetupStep.Loading, SetupStep.Done, SetupStep.Codes -> {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            }

            SetupStep.Expired -> {
                Text(
                    state.formError?.let { uiString(it) } ?: stringResource(R.string.twostep_setup_expired),
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                AppButton(stringResource(R.string.twostep_setup_start_again), onStartAgain)
            }

            SetupStep.Scan -> {
                val secret = state.secret
                if (!replace) Text(stringResource(R.string.twostep_setup_step, 1), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(stringResource(R.string.twostep_setup_steps))
                state.formError?.let { ErrorLine(uiString(it)) }
                if (secret != null) {
                    Text(
                        stringResource(R.string.twostep_setup_scan),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.semantics { heading() },
                    )
                    val bitmap = remember(secret.otpauthUri) { qrBitmap(secret.otpauthUri).asImageBitmap() }
                    Image(
                        bitmap = bitmap,
                        contentDescription = stringResource(R.string.twostep_qr_alt),
                        modifier = Modifier.size(QR_SIZE_DP.dp),
                        filterQuality = FilterQuality.None,
                    )
                    AppButton(stringResource(R.string.twostep_open_app), onOpenInApp, variant = AppButtonVariant.Secondary)
                    Text(stringResource(R.string.twostep_setup_cant_scan))
                    Text(
                        isolated(secret.secret),
                        style =
                        MaterialTheme.typography.titleMedium.copy(
                            fontFamily = FontFamily.Monospace,
                            textDirection = TextDirection.Ltr,
                        ),
                    )
                    AppButton(stringResource(R.string.twostep_setup_copy), onCopyKey, variant = AppButtonVariant.Secondary)
                }
                AppTextField(
                    value = state.code,
                    onValueChange = onCodeChange,
                    label = stringResource(R.string.twostep_code),
                    error = state.error?.let { stringResource(it) },
                    keyboardType = KeyboardType.NumberPassword,
                    keyboardActions = KeyboardActions(onDone = { onSubmit() }),
                    imeAction = ImeAction.Done,
                    readOnly = state.busy,
                )
                AppButton(stringResource(if (replace) R.string.twostep_verify else R.string.twostep_setup_submit), onSubmit, Modifier.fillMaxWidth(), busy = state.busy)
            }
        }
    }
}

/** The ten recovery codes, shown once; Done needs the box ticked. */
@Composable
fun RecoveryCodesScreen(
    codes: List<String>,
    acknowledged: Boolean,
    onAcknowledgedChange: (Boolean) -> Unit,
    onCopyAll: () -> Unit,
    onShare: () -> Unit,
    onDone: () -> Unit,
    newCodes: Boolean = false,
    modifier: Modifier = Modifier,
) {
    Page(modifier) {
        Heading(stringResource(R.string.twostep_codes_title))
        if (newCodes) Text(stringResource(R.string.twostep_new_codes_done))
        Text(stringResource(R.string.twostep_codes_body))
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for (code in codes) {
                Text(
                    code,
                    style =
                    MaterialTheme.typography.titleMedium.copy(
                        fontFamily = FontFamily.Monospace,
                        textDirection = TextDirection.Ltr,
                    ),
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AppButton(stringResource(R.string.twostep_codes_copy), onCopyAll, variant = AppButtonVariant.Secondary)
            AppButton(stringResource(R.string.twostep_codes_share), onShare, variant = AppButtonVariant.Secondary)
        }
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .toggleable(value = acknowledged, role = Role.Checkbox, onValueChange = onAcknowledgedChange),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Checkbox(checked = acknowledged, onCheckedChange = null)
            Text(stringResource(R.string.twostep_codes_ack))
        }
        AppButton(stringResource(R.string.twostep_codes_done), onDone, Modifier.fillMaxWidth(), enabled = acknowledged)
    }
}

/** Puts [text] on the clipboard, marked sensitive so the system hides it from previews. */
private fun copySensitive(
    context: Context,
    text: String,
    scope: CoroutineScope,
    snackbar: SnackbarHostState,
    copiedMessage: String,
) {
    val clip = ClipData.newPlainText("", text)
    clip.description.extras = PersistableBundle().apply { putBoolean(SENSITIVE_EXTRA, true) }
    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(clip)
    // Android 13 and later show their own confirmation.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) scope.launch { snackbar.showSnackbar(copiedMessage) }
}

private fun shareText(
    context: Context,
    text: String,
) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    try {
        context.startActivity(Intent.createChooser(send, null))
    } catch (_: ActivityNotFoundException) {
        // Nothing can share it; Copy all is still there.
    }
}

/** The setup (or replace) route: the screen under [SecureWindow], and the codes once enabled. */
@Composable
fun TwoStepSetupRoute(
    viewModel: TwoStepSetupViewModel,
    replace: Boolean,
    onDone: () -> Unit,
) {
    SecureWindow()
    val state = viewModel.state
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val noApp = stringResource(R.string.twostep_no_app)
    val copied = stringResource(R.string.twostep_copied)
    LaunchedEffect(Unit) { viewModel.start(replace) }
    LaunchedEffect(state.step) { if (state.step == SetupStep.Done) onDone() }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Box(Modifier.padding(padding)) {
            if (state.step == SetupStep.Codes) {
                RecoveryCodesScreen(
                    codes = state.codes,
                    acknowledged = state.acknowledged,
                    onAcknowledgedChange = viewModel::onAcknowledgedChange,
                    onCopyAll = { copySensitive(context, state.codes.joinToString("\n"), scope, snackbar, copied) },
                    onShare = { shareText(context, state.codes.joinToString("\n")) },
                    onDone = viewModel::finish,
                )
            } else {
                TwoStepSetupScreen(
                    state = state,
                    onCodeChange = viewModel::onCodeChange,
                    onSubmit = viewModel::submit,
                    onOpenInApp = {
                        val uri = state.secret?.otpauthUri
                        if (uri != null) {
                            try {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
                            } catch (_: ActivityNotFoundException) {
                                scope.launch { snackbar.showSnackbar(noApp) }
                            }
                        }
                    },
                    onCopyKey = {
                        state.secret?.let { copySensitive(context, it.secret.filterNot { c -> c.isWhitespace() }, scope, snackbar, copied) }
                    },
                    onStartAgain = viewModel::startAgain,
                    replace = replace,
                )
            }
        }
    }
}

// ---- Sign-in & security: the two-step section (F-214) ----

/** The two-step section: status, and the actions that fit it. */
@Composable
fun SecurityScreen(
    me: Me,
    onTurnOn: () -> Unit,
    onTurnOff: () -> Unit,
    onReplace: () -> Unit,
    onCreateCodes: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Page(modifier) {
        Heading(stringResource(R.string.twostep_title))
        Text(stringResource(if (me.twoStepEnabled) R.string.twostep_status_on else R.string.twostep_status_off))
        if (me.twoStepEnabled && !me.codesAcknowledged) {
            Text(stringResource(R.string.twostep_codes_unsaved), color = MaterialTheme.colorScheme.error)
        }
        if (me.twoStepEnabled) {
            AppButton(stringResource(R.string.twostep_off), onTurnOff, variant = AppButtonVariant.Secondary)
            AppButton(stringResource(R.string.twostep_replace), onReplace, variant = AppButtonVariant.Secondary)
            AppButton(stringResource(R.string.twostep_create_new), onCreateCodes, variant = AppButtonVariant.Secondary)
        } else {
            AppButton(stringResource(R.string.twostep_turn_on), onTurnOn, variant = AppButtonVariant.Secondary)
        }
    }
}

/** "Turn off two-step verification?": a code or recovery code, sent with the request itself. */
@Composable
fun TurnOffTwoStepDialog(
    form: TurnOffFormState,
    onValueChange: (String) -> Unit,
    onToggleRecovery: () -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val focus = rememberFieldFocus(form.error, form.useRecovery)
    AlertDialog(
        onDismissRequest = { if (!form.busy) onDismiss() },
        title = { Text(stringResource(R.string.twostep_off_confirm)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                form.formError?.let { ErrorLine(uiString(it)) }
                if (form.showRecoveryHint) Text(stringResource(R.string.twostep_limit_recovery))
                AppTextField(
                    value = form.value,
                    onValueChange = onValueChange,
                    label = stringResource(if (form.useRecovery) R.string.twostep_recovery else R.string.twostep_code),
                    error = form.error?.let { stringResource(it) },
                    keyboardType = if (form.useRecovery) KeyboardType.Text else KeyboardType.NumberPassword,
                    keyboardActions = KeyboardActions(onDone = { onConfirm() }),
                    imeAction = ImeAction.Done,
                    readOnly = form.busy,
                    fieldModifier = Modifier.focusRequester(focus),
                )
                TextButton(onClick = { if (!form.busy) onToggleRecovery() }) {
                    Text(stringResource(if (form.useRecovery) R.string.twostep_use_code else R.string.twostep_use_recovery))
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !form.busy) {
                if (form.busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Text(stringResource(R.string.twostep_off))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !form.busy) { Text(stringResource(R.string.confirm_cancel)) }
        },
    )
}

/** Sign-in & security: refreshes `me` on every show; Turn off and Create new codes live here. */
@Composable
fun SecurityRoute(
    me: Me,
    viewModel: SecurityViewModel,
    onMeUpdated: (Me) -> Unit,
    onTurnOn: () -> Unit,
    onReplace: () -> Unit,
    onBack: () -> Unit,
) {
    val state = viewModel.state
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val copied = stringResource(R.string.twostep_copied)
    LaunchedEffect(Unit) { viewModel.refresh(onMeUpdated) }
    val message = state.message?.let { uiString(it) }
    LaunchedEffect(message) {
        if (message != null) {
            snackbar.showSnackbar(message)
            viewModel.messageShown()
        }
    }
    val codes = state.newCodes
    BackHandler(enabled = codes == null) { onBack() }
    BackHandler(enabled = codes != null) { viewModel.leaveNewCodes() }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Box(Modifier.padding(padding)) {
            if (codes != null) {
                SecureWindow()
                RecoveryCodesScreen(
                    codes = codes,
                    acknowledged = state.acknowledged,
                    onAcknowledgedChange = viewModel::onAcknowledgedChange,
                    onCopyAll = { copySensitive(context, codes.joinToString("\n"), scope, snackbar, copied) },
                    onShare = { shareText(context, codes.joinToString("\n")) },
                    onDone = { viewModel.finishNewCodes(onMeUpdated) },
                    newCodes = true,
                )
            } else {
                SecurityScreen(
                    me = me,
                    onTurnOn = onTurnOn,
                    onTurnOff = viewModel::openTurnOff,
                    onReplace = onReplace,
                    onCreateCodes = { viewModel.createNewCodes(onMeUpdated) },
                )
                state.turnOff?.let { form ->
                    TurnOffTwoStepDialog(
                        form = form,
                        onValueChange = viewModel::onTurnOffValueChange,
                        onToggleRecovery = viewModel::toggleTurnOffRecovery,
                        onConfirm = { viewModel.submitTurnOff(onMeUpdated) },
                        onDismiss = viewModel::dismissTurnOff,
                    )
                }
            }
        }
    }
}
