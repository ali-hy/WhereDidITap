// F-260: what may reach Sentry, F-35's allowlist on Android. The scrubbed event is built from the
// allowed fields only (review B-3), so anything an SDK integration or a later module adds is dropped.
package com.budmon.app.core.observability

import io.sentry.Breadcrumb
import io.sentry.Hint
import io.sentry.SentryEvent
import io.sentry.SentryOptions
import io.sentry.SpanContext
import io.sentry.protocol.SentryException
import io.sentry.protocol.SentryStackFrame
import io.sentry.protocol.SentryStackTrace
import io.sentry.protocol.User
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** An API error key (A-101) may stay as an exception value; anything else becomes the type. */
private val ERROR_KEY = Regex("^[A-Z][A-Z0-9_]{1,63}$")
private val UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

// A-110's frame patterns.
private val FRAME_FUNCTION = Regex("^(?:(?:async|new) )?[A-Za-z_$][A-Za-z0-9_$.<>\\[\\]]{0,99}$")
private val FRAME_FILENAME = Regex("^[A-Za-z0-9_@./<>:-]{1,200}$")

// F-35's tag allowlist and F-30's value rules.
private val TOKEN = Regex("^[A-Za-z0-9_.:-]{1,64}$")
private val ROUTE = Regex("^/[A-Za-z0-9_./:{}-]{0,200}(/\\*)?$")
private val UUID_LIKE = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
private val LONG_DIGITS = Regex("\\d{5}")
private val REQUEST_ID = Regex("^[0-9a-f]{32}$")
private val JOB_NAME = Regex("^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*$")
private val SQLSTATE = Regex("^[0-9A-Z]{5}$")
private val SYSTEM_CODE = Regex("^E[A-Z0-9_]{1,30}$")
private val METHOD = Regex("^[A-Z]{1,10}$")

/** A-501 (4): Sentry's breadcrumb types; any other `type` is left out (null). */
private val BREADCRUMB_TYPES =
    setOf("default", "debug", "error", "info", "navigation", "http", "query", "transaction", "ui", "user")

private fun isRoute(value: String): Boolean {
    val path = value.substringBefore('?').substringBefore('#')
    return ROUTE.matches(path) && path.split('/').none { UUID_LIKE.containsMatchIn(it) || LONG_DIGITS.containsMatchIn(it) }
}

private fun validTag(key: String, value: String): String? = when (key) {
    "route" -> value.substringBefore('?').substringBefore('#').takeIf { isRoute(value) }
    "job" -> value.takeIf { JOB_NAME.matches(it) }
    "client_kind" -> value.takeIf { TOKEN.matches(it) }
    "request_id" -> value.takeIf { REQUEST_ID.matches(it) }
    "error_key" -> value.takeIf { ERROR_KEY.matches(it) }
    "error_code" -> value.takeIf { SQLSTATE.matches(it) || SYSTEM_CODE.matches(it) }
    "http_status" -> value.takeIf { it.toIntOrNull()?.let { n -> n in 100..599 } == true }
    else -> null
}

/**
 * A-485: JVM frames carry a bare source-file name (`Worker.kt`); anything with `/`, `\` or `:`
 * (a device path, a Windows path or a URL) becomes `<unknown>`. Idempotent.
 */
internal fun reduceFrameFilename(filename: String): String =
    if (filename.any { it == '/' || it == '\\' || it == ':' }) "<unknown>" else filename

private fun scrubFrame(frame: SentryStackFrame): SentryStackFrame? {
    val function = frame.function
    // A-485: no filename drops the frame; the reduced name is what A-110's pattern checks.
    val raw = frame.filename
    if (raw.isNullOrEmpty()) return null
    val filename = reduceFrameFilename(raw)
    if (function != null && !FRAME_FUNCTION.matches(function)) return null
    if (!FRAME_FILENAME.matches(filename)) return null
    return SentryStackFrame().apply {
        this.function = function
        this.filename = filename
        lineno = frame.lineno
        colno = frame.colno
        isInApp = frame.isInApp
    }
}

private fun scrubException(e: SentryException): SentryException = SentryException().apply {
    type = e.type
    val v = e.value
    value = if (v != null && ERROR_KEY.matches(v)) v else e.type
    val frames = e.stacktrace?.frames?.mapNotNull { scrubFrame(it) }
    if (frames != null) stacktrace = SentryStackTrace(frames)
}

/**
 * F-260 (A-498): an HTTP crumb's URL as its path only, OkHttp's `encodedPath` (always starting
 * with `/`, keeping any base-URL prefix): no scheme, userinfo, host, port, query or fragment. Null
 * when it isn't an absolute http(s) URL, so the crumb is kept without `data.url`.
 */
private fun reduceUrl(raw: String): String? = raw.toHttpUrlOrNull()?.encodedPath

class SentryScrubber : SentryOptions.BeforeSendCallback {
    override fun execute(event: SentryEvent, hint: Hint): SentryEvent? {
        val scrubbed = SentryEvent(event.timestamp)
        event.eventId?.let { scrubbed.eventId = it }
        scrubbed.platform = event.platform
        scrubbed.level = event.level
        scrubbed.release = event.release
        scrubbed.environment = event.environment
        scrubbed.exceptions = event.exceptions?.map { scrubException(it) }
        event.tags?.forEach { (key, value) ->
            validTag(key, value)?.let { scrubbed.setTag(key, it) }
        }
        val userId = event.user?.id
        if (userId != null && UUID.matches(userId)) scrubbed.user = User().apply { id = userId }
        // contexts.trace.{trace_id, span_id} only. SpanContext needs a non-null operation; it is
        // left empty so nothing from the original span's op is sent.
        event.contexts.trace?.let { trace ->
            scrubbed.contexts.setTrace(SpanContext(trace.traceId, trace.spanId, "", null, null))
        }
        scrubbed.breadcrumbs = event.breadcrumbs?.mapNotNull { scrubBreadcrumb(it) }
        return scrubbed
    }

    companion object {
        /**
         * F-35, F-260: navigation and HTTP crumbs only, with exactly category, timestamp, level and
         * a type from Sentry's breadcrumb types (A-501 (4)); navigation keeps no data; an HTTP crumb also keeps data.url as the path only
         * (A-498), method (`^[A-Z]{1,10}$`) and a numeric status_code, each only when valid.
         */
        fun scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb? {
            val category = crumb.category
            if (category != "navigation" && category != "http") return null
            val kept = Breadcrumb(crumb.timestamp)
            kept.category = category
            kept.type = crumb.type?.takeIf { it in BREADCRUMB_TYPES }
            kept.level = crumb.level
            if (category == "http") {
                (crumb.getData("url") as? String)?.let { reduceUrl(it) }?.let { kept.setData("url", it) }
                (crumb.getData("method") as? String)?.takeIf { METHOD.matches(it) }?.let { kept.setData("method", it) }
                (crumb.getData("status_code") as? Number)?.let { kept.setData("status_code", it) }
            }
            return kept
        }
    }
}
