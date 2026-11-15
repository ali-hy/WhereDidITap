// P-A-524: the shared button (UX guide §7, §15): 8 dp corners, 48 dp tall, Material's pill overridden.
package com.budmon.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp

enum class AppButtonVariant { Primary, Secondary, Tertiary, Destructive }

private val ButtonShape = RoundedCornerShape(8.dp)
private val MinHeight = 48.dp

/** [busy] keeps the label, shows a spinner and ignores taps. */
@Composable
fun AppButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: AppButtonVariant = AppButtonVariant.Primary,
    enabled: Boolean = true,
    busy: Boolean = false,
) {
    val sized = modifier.heightIn(min = MinHeight)
    val action = { if (!busy) onClick() }
    val content: @Composable () -> Unit = {
        if (busy) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = androidx.compose.material3.LocalContentColor.current)
        }
        Text(text)
    }
    val busyModifier = if (busy) sized.semantics { stateDescription = text } else sized
    when (variant) {
        AppButtonVariant.Primary ->
            Button(action, busyModifier, enabled, ButtonShape, content = { RowContent(content) })

        AppButtonVariant.Destructive ->
            Button(
                action,
                busyModifier,
                enabled,
                ButtonShape,
                ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                ),
                content = { RowContent(content) },
            )

        AppButtonVariant.Secondary ->
            OutlinedButton(
                action,
                busyModifier,
                enabled,
                ButtonShape,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                content = { RowContent(content) },
            )

        AppButtonVariant.Tertiary ->
            TextButton(action, busyModifier, enabled, ButtonShape, content = { RowContent(content) })
    }
}

@Composable
private fun RowContent(content: @Composable () -> Unit) {
    androidx.compose.foundation.layout.Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
    ) { content() }
}
