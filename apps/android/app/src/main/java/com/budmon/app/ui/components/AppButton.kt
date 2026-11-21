// P-A-524, A-528: the shared button (UX guide §7, §15): 8 dp corners, 48 dp tall.
package com.budmon.app.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp

enum class AppButtonVariant { Primary, Secondary, Tertiary, Destructive }

private val ButtonShape = RoundedCornerShape(8.dp)
private val MinHeight = 48.dp

/**
 * [busy] swaps the icon for a spinner and ignores taps; the label stays and the button stays
 * enabled.
 */
@Composable
fun AppButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: AppButtonVariant = AppButtonVariant.Primary,
    enabled: Boolean = true,
    busy: Boolean = false,
    @DrawableRes icon: Int? = null,
) {
    val sized = modifier.heightIn(min = MinHeight)
    val action = { if (!busy) onClick() }
    val content: @Composable () -> Unit = {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (busy) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = LocalContentColor.current)
            } else if (icon != null) {
                Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(20.dp))
            }
            Text(text)
        }
    }
    when (variant) {
        AppButtonVariant.Primary -> {
            Button(action, sized, enabled, ButtonShape, content = { content() })
        }

        AppButtonVariant.Destructive -> {
            Button(
                action,
                sized,
                enabled,
                ButtonShape,
                ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                ),
                content = { content() },
            )
        }

        AppButtonVariant.Secondary -> {
            OutlinedButton(
                action,
                sized,
                enabled,
                ButtonShape,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                content = { content() },
            )
        }

        AppButtonVariant.Tertiary -> {
            TextButton(action, sized, enabled, ButtonShape, content = { content() })
        }
    }
}
