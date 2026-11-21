// P-A-524: the shared text fields and the wordmark (UX guide §8, §2.1, §15).
package com.budmon.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.budmon.app.R
import com.budmon.app.ui.theme.AppColors
import com.budmon.app.ui.theme.PlexSans

private val FieldShape = RoundedCornerShape(8.dp)
private val FieldMinHeight = 48.dp

/** A single-line field: label above, hint and error below; the error is also its semantics error. */
@Composable
fun AppTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
    error: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    imeAction: androidx.compose.ui.text.input.ImeAction = androidx.compose.ui.text.input.ImeAction.Next,
    readOnly: Boolean = false,
    contentType: ContentType? = null,
    trailing: (@Composable () -> Unit)? = null,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    fieldModifier: Modifier = Modifier,
) {
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = FieldMinHeight)
                .then(fieldModifier)
                .semantics {
                    contentDescription = label
                    if (contentType != null) this.contentType = contentType
                    if (error != null) error(error)
                },
            singleLine = true,
            readOnly = readOnly,
            isError = error != null,
            shape = FieldShape,
            visualTransformation = visualTransformation,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
            keyboardActions = keyboardActions,
            trailingIcon = trailing,
        )
        // The hint, then the error row; both show when both are given.
        if (hint != null) {
            Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (error != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(
                    painterResource(R.drawable.lucide_circle_alert),
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.error,
                )
                Text(error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

/** A password field with a Show / Hide toggle; the toggle's name is "Show password" / "Hide password". */
@Composable
fun AppPasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
    error: String? = null,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    imeAction: androidx.compose.ui.text.input.ImeAction = androidx.compose.ui.text.input.ImeAction.Done,
    readOnly: Boolean = false,
    contentType: ContentType? = null,
) {
    var shown by rememberSaveable { mutableStateOf(false) }
    val toggleName = stringResource(if (shown) R.string.ui_password_hide_label else R.string.ui_password_show_label)
    AppTextField(
        value = value,
        onValueChange = onValueChange,
        label = label,
        modifier = modifier,
        hint = hint,
        error = error,
        keyboardType = KeyboardType.Password,
        keyboardActions = keyboardActions,
        imeAction = imeAction,
        readOnly = readOnly,
        contentType = contentType,
        visualTransformation = if (shown) VisualTransformation.None else PasswordVisualTransformation(),
        trailing = {
            TextButton(
                onClick = { shown = !shown },
                modifier = Modifier.heightIn(min = FieldMinHeight).semantics { contentDescription = toggleName },
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        painterResource(if (shown) R.drawable.lucide_eye_off else R.drawable.lucide_eye),
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                    )
                    Text(stringResource(if (shown) R.string.ui_password_hide else R.string.ui_password_show))
                }
            }
        },
    )
}

/** "wDit" in Plex Sans 600 at 20 sp with the "D" in the accent colour; one name, always left to right. */
@Composable
fun Wordmark(modifier: Modifier = Modifier) {
    val accent = AppColors.extra.accentFg
    val text: AnnotatedString =
        buildAnnotatedString {
            append("w")
            withStyle(SpanStyle(color = accent)) { append("D") }
            append("it")
        }
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        Text(
            text,
            modifier = modifier,
            style =
            MaterialTheme.typography.titleLarge.copy(
                fontFamily = PlexSans,
                fontWeight = FontWeight.SemiBold,
                fontSize = 20.sp,
            ),
        )
    }
}
