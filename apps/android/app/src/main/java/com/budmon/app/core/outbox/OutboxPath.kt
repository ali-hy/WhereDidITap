// F-255 (A-474): an outbox entry's path is relative to the API root (`api/v1/`), never absolute,
// so a base-URL path prefix is kept and a stored entry can't reach another host.
package com.budmon.app.core.outbox

import okhttp3.HttpUrl

private val SCHEME = Regex("^[A-Za-z][A-Za-z0-9+.-]*:")

/** The URL `path` resolves to under `apiRoot`, or null when the path isn't a safe relative one. */
fun resolveOutboxPath(apiRoot: HttpUrl, path: String): HttpUrl? {
    if (path.isEmpty() || path.startsWith("/") || SCHEME.containsMatchIn(path)) return null
    if (path.any { it == '\\' || it == '#' || it.isWhitespace() }) return null
    // A percent-encoded dot (%2e, either case) counts as a dot: OkHttp resolves "%2e%2E" as "..".
    val segments = path.substringBefore('?').split('/').map { it.replace("%2e", ".", ignoreCase = true) }
    if (segments.any { it == "." || it == ".." }) return null
    val resolved = apiRoot.resolve(path) ?: return null
    return if (resolved.toString().startsWith(apiRoot.toString())) resolved else null
}
