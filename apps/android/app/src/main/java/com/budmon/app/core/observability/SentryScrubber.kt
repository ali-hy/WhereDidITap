// F-260: what may reach Sentry, F-35's allowlist on Android.
package com.budmon.app.core.observability

import io.sentry.Breadcrumb
import io.sentry.Hint
import io.sentry.SentryEvent
import io.sentry.SentryOptions
import io.sentry.protocol.User

/** An API error key (A-101) may stay as an exception value; anything else becomes the type. */
private val ERROR_KEY = Regex("^[A-Z][A-Z0-9_]{1,63}$")
private val UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

class SentryScrubber : SentryOptions.BeforeSendCallback {
    override fun execute(event: SentryEvent, hint: Hint): SentryEvent? {
        event.request = null
        event.extras
            ?.keys
            ?.toList()
            ?.forEach { event.removeExtra(it) }
        event.message = null
        event.serverName = null
        event.fingerprints = null
        val userId = event.user?.id
        event.user = if (userId != null && UUID.matches(userId)) User().apply { id = userId } else null
        event.exceptions?.forEach { e ->
            val value = e.value
            e.value = if (value != null && ERROR_KEY.matches(value)) value else e.type
        }
        // Only the trace context survives.
        event.contexts
            .keys()
            .toList()
            .filter { it != "trace" }
            .forEach { event.contexts.remove(it) }
        event.breadcrumbs = event.breadcrumbs?.mapNotNull { scrubBreadcrumb(it) }
        return event
    }

    companion object {
        /** Navigation and HTTP crumbs only, with URLs reduced to their path. */
        fun scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb? {
            val category = crumb.category
            if (category != "navigation" && category != "http" && crumb.type != "navigation" && crumb.type != "http") return null
            val kept = Breadcrumb(crumb.timestamp)
            kept.category = category
            kept.type = crumb.type
            kept.level = crumb.level
            for (key in listOf("url", "from", "to")) {
                (crumb.getData(key) as? String)?.let { kept.setData(key, it.substringBefore('?').substringBefore('#')) }
            }
            (crumb.getData("method") as? String)?.takeIf { it.matches(Regex("^[A-Z]{1,10}$")) }?.let { kept.setData("method", it) }
            (crumb.getData("status_code") as? Number)?.let { kept.setData("status_code", it) }
            return kept
        }
    }
}
