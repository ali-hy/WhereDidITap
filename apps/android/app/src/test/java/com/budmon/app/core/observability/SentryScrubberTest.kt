// F-260 SentryScrubber. TP-13.8.
package com.budmon.app.core.observability

import io.sentry.Breadcrumb
import io.sentry.Hint
import io.sentry.JsonSerializer
import io.sentry.SentryEvent
import io.sentry.SentryLevel
import io.sentry.SentryOptions
import io.sentry.protocol.Message
import io.sentry.protocol.Request
import io.sentry.protocol.SentryException
import io.sentry.protocol.SentryStackFrame
import io.sentry.protocol.SentryStackTrace
import io.sentry.protocol.SentryThread
import io.sentry.protocol.User
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.StringWriter
import java.util.Base64

class SentryScrubberTest {
    // F-198's canary shape, standing in for user data.
    private val canary = "CANARY-android-tp-13-8-7f3a"

    private fun event() = SentryEvent().apply {
        request = Request().apply {
            url = "https://budmon.example/api/v1/things?q=$canary"
            data = canary
        }
        setExtra("note", canary)
        user = User().apply {
            id = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b"
            email = "$canary@example.com"
        }
        exceptions = listOf(
            SentryException().apply {
                type = "IllegalStateException"
                value = "bad $canary"
            },
        )
        message = Message().apply { formatted = "x" }
    }

    @Test
    fun `TP-13_8 beforeSend keeps only allowlisted fields, with no canary`() {
        val scrubbed = SentryScrubber().execute(event(), Hint())

        assertNotNull(scrubbed)
        scrubbed!!
        assertNull(scrubbed.request)
        assertNull(scrubbed.getExtra("note"))
        assertEquals("0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b", scrubbed.user?.id)
        assertNull(scrubbed.user?.email)
        assertEquals("IllegalStateException", scrubbed.exceptions?.first()?.value)
        val text = listOf(
            scrubbed.request,
            scrubbed.extras,
            scrubbed.user?.email,
            scrubbed.exceptions?.map {
                it.value
            },
            scrubbed.contexts.keys().toList(),
        ).toString()
        assertFalse(text.contains(canary))
    }

    @Test
    fun `TP-13_8 an API error key stays as the exception value (A-101)`() {
        val e = SentryEvent().apply {
            exceptions = listOf(
                SentryException().apply {
                    type = "ApiException"
                    value = "VALIDATION_FAILED"
                },
            )
        }

        assertEquals("VALIDATION_FAILED", SentryScrubber().execute(e, Hint())?.exceptions?.first()?.value)
    }

    // ---- Review B-8: F-35's allowlist, checked on the serialized event ----

    private fun serialized(event: SentryEvent): String = StringWriter().also {
        JsonSerializer(SentryOptions()).serialize(event, it)
    }.toString()

    /** An event with the canary in every place F-35 doesn't allow (or allows only when valid). */
    private fun everywhere() = event().apply {
        setTag("payee", canary)
        setTag("error_key", "x $canary !")
        transaction = "/things/$canary"
        exceptions = listOf(
            SentryException().apply {
                type = "IllegalStateException"
                value = "bad $canary"
                module = "com.example.$canary"
            },
        )
        threads = listOf(
            SentryThread().apply {
                name = "worker-$canary"
                stacktrace = SentryStackTrace(
                    listOf(
                        SentryStackFrame().apply {
                            function = "run"
                            filename = "Worker.kt"
                            vars = mapOf("note" to canary)
                        },
                    ),
                )
            },
        )
        contexts.put("app_state", mapOf("note" to canary))
    }

    @Test
    fun `TP-13_8 (B-8) no canary anywhere in the serialized event - tags, transaction, module, threads, contexts`() {
        val scrubbed = SentryScrubber().execute(everywhere(), Hint())

        assertNotNull(scrubbed)
        val json = serialized(scrubbed!!)
        assertFalse(json, json.contains(canary))
        assertNull(scrubbed.getTag("payee"))
        assertNull(scrubbed.getTag("error_key"))
        assertNull(scrubbed.transaction)
        assertFalse(scrubbed.contexts.keys().toList().contains("app_state"))
    }

    @Test
    fun `TP-13_8 (B-8) the unscrubbed event does contain the canary (the check can fail)`() {
        assertTrue(serialized(everywhere()).contains(canary))
    }

    @Test
    fun `TP-13_8 (B-8, A-498) an http breadcrumb keeps the url path only, no query or userinfo, plus method and status`() {
        val crumb = Breadcrumb().apply {
            type = "http"
            category = "http"
            setData("url", "https://user:pw@budmon.example/api/v1/things?q=$canary#frag")
            setData("method", "GET")
            setData("status_code", 200)
            setData("note", canary)
        }

        val kept = SentryScrubber.scrubBreadcrumb(crumb)

        assertNotNull(kept)
        assertEquals("/api/v1/things", kept!!.getData("url"))
        assertEquals("GET", kept.getData("method"))
        assertEquals(200, kept.getData("status_code"))
        assertEquals(setOf("url", "method", "status_code"), kept.data.keys)
    }

    // ---- A-498, A-499: an http crumb's url is the path only, or absent ----

    private val canaryBase64: String = Base64.getEncoder().encodeToString(canary.toByteArray())

    private fun httpCrumb(url: String) = Breadcrumb().apply {
        type = "http"
        category = "http"
        setData("url", url)
        setData("method", "GET")
        setData("status_code", 200)
        setData("note", canary)
    }

    private fun assertNothingIdentifying(input: String, kept: Breadcrumb) {
        val data = kept.data.toString()
        for (banned in listOf("budmon.example", "ts.net", "localhost", "pw@", canary, canaryBase64)) {
            assertFalse("$input: data has $banned: $data", data.contains(banned))
        }
    }

    @Test
    fun `TP-13_8 (A-498) u1 to u4 - http crumbs keep url, method and status_code, with the url path only`() {
        val cases = listOf(
            "https://user:pw@budmon.example/api/v1/things?q=$canary#frag" to "/api/v1/things",
            "https://laptop.tail1234.ts.net:8443" to "/",
            "http://localhost:8080/api/v1/x" to "/api/v1/x",
            "https://budmon.example/budmon/api/v1/things" to "/budmon/api/v1/things",
        )

        for ((input, path) in cases) {
            val kept = SentryScrubber.scrubBreadcrumb(httpCrumb(input))

            assertNotNull(input, kept)
            assertEquals(input, setOf("url", "method", "status_code"), kept!!.data.keys)
            assertEquals(input, path, kept.getData("url"))
            assertEquals(input, "GET", kept.getData("method"))
            assertEquals(input, 200, kept.getData("status_code"))
            assertNothingIdentifying(input, kept)
        }
    }

    @Test
    fun `TP-13_8 (A-499) u5 to u8 - a url that isn't an absolute http or https URL is dropped, method and status_code kept`() {
        val cases = listOf(
            "data:text/plain;base64,$canaryBase64",
            "mailto:$canary@b.example",
            "/api/v1/things?q=$canary",
            "ftp://h/$canary",
        )

        for (input in cases) {
            val kept = SentryScrubber.scrubBreadcrumb(httpCrumb(input))

            assertNotNull(input, kept)
            assertEquals(input, setOf("method", "status_code"), kept!!.data.keys)
            assertNothingIdentifying(input, kept)
        }
    }

    @Test
    fun `TP-13_8 (A-498) an invalid method or a non-numeric status_code is dropped, the crumb's other keys kept`() {
        val url = "https://budmon.example/api/v1/things"
        val cases = listOf(
            Triple("method get", httpCrumb(url).apply { setData("method", "get") }, setOf("url", "status_code")),
            Triple("method GET canary", httpCrumb(url).apply { setData("method", "GET $canary") }, setOf("url", "status_code")),
            Triple("status_code \"200\"", httpCrumb(url).apply { setData("status_code", "200") }, setOf("url", "method")),
        )

        for ((label, crumb, keys) in cases) {
            val kept = SentryScrubber.scrubBreadcrumb(crumb)

            assertNotNull(label, kept)
            assertEquals(label, keys, kept!!.data.keys)
            assertEquals(label, "/api/v1/things", kept.getData("url"))
            if ("method" in keys) assertEquals(label, "GET", kept.getData("method"))
            if ("status_code" in keys) assertEquals(label, 200, kept.getData("status_code"))
            assertFalse(label, kept.data.toString().contains(canary))
        }
    }

    @Test
    fun `TP-13_8 (B-8) a navigation breadcrumb keeps no data (from and to are dropped)`() {
        val crumb = Breadcrumb().apply {
            type = "navigation"
            category = "navigation"
            setData("from", "/things/$canary")
            setData("to", "/things/$canary/edit")
        }

        val kept = SentryScrubber.scrubBreadcrumb(crumb)

        assertNotNull(kept)
        assertTrue(kept!!.data.toString(), kept.data.isEmpty())
        // A-501 (4): navigation is one of Sentry's breadcrumb types, so it's kept.
        assertEquals("navigation", kept.type)
    }

    // ---- A-501 (4): an http crumb keeps type only when it's one of Sentry's breadcrumb types ----

    @Test
    fun `TP-13_8 (A-501) y1 - type http is kept with the level and the timestamp`() {
        val crumb = httpCrumb("https://budmon.example/api/v1/things").apply { level = SentryLevel.WARNING }

        val kept = SentryScrubber.scrubBreadcrumb(crumb)

        assertNotNull(kept)
        assertEquals("http", kept!!.type)
        assertEquals(SentryLevel.WARNING, kept.level)
        assertEquals(crumb.timestamp, kept.timestamp)
    }

    @Test
    fun `TP-13_8 (A-501) y2 to y4 - a type outside Sentry's set is left null, the crumb and its data kept`() {
        for (type in listOf(canary, "laptop.tail1234.ts.net", "HTTP")) {
            val crumb = httpCrumb("https://budmon.example/api/v1/things").apply {
                this.type = type
                level = SentryLevel.WARNING
            }

            val kept = SentryScrubber.scrubBreadcrumb(crumb)

            assertNotNull(type, kept)
            assertNull(type, kept!!.type)
            assertEquals(type, SentryLevel.WARNING, kept.level)
            assertEquals(type, setOf("url", "method", "status_code"), kept.data.keys)
            assertFalse(type, serializedCrumb(kept).contains(canary))
            assertFalse(type, serializedCrumb(kept).contains("ts.net"))
        }
    }

    private fun serializedCrumb(crumb: Breadcrumb): String = StringWriter().also {
        JsonSerializer(SentryOptions()).serialize(crumb, it)
    }.toString()

    @Test
    fun `TP-13_8 (B-8) a ui click breadcrumb is dropped`() {
        val crumb = Breadcrumb().apply {
            type = "user"
            category = "ui.click"
            setData("view.id", canary)
        }

        assertNull(SentryScrubber.scrubBreadcrumb(crumb))
    }

    // ---- Re-review 5636303270 B-2: frames, tags and user (A-110, F-30, F-35) ----

    private fun frame(fn: String?, file: String?) = SentryStackFrame().apply {
        function = fn
        filename = file
        lineno = 12
        colno = 4
        isInApp = true
    }

    @Test
    fun `TP-13_8 (A-485) nine frames - 1 kept, 3 to 7 kept as unknown, 2, 8 and 9 dropped`() {
        val valid = frame("run", "Worker.kt").apply {
            vars = mapOf("note" to canary)
            contextLine = "val note = \"$canary\""
            module = "com.example.$canary"
        }
        val e = SentryEvent().apply {
            exceptions = listOf(
                SentryException().apply {
                    type = "IllegalStateException"
                    value = "bad"
                    stacktrace = SentryStackTrace(
                        listOf(
                            valid,
                            frame("x $canary", "Worker.kt"),
                            frame("run", "/data/user/0/$canary/x.kt"),
                            frame("run", "/data/user/0/$canary x.kt"),
                            frame("run", "C:\\src\\$canary.kt"),
                            frame("run", "https://h.example/$canary.kt"),
                            frame("run", "<unknown>"),
                            frame("run", null),
                            frame("run", ""),
                        ),
                    )
                },
            )
        }

        val scrubbed = SentryScrubber().execute(e, Hint())!!
        val frames = scrubbed.exceptions!!.single().stacktrace!!.frames!!

        assertEquals(listOf("Worker.kt", "<unknown>", "<unknown>", "<unknown>", "<unknown>", "<unknown>"), frames.map { it.filename })
        assertTrue(frames.all { it.function == "run" })
        val kept = frames.first()
        assertEquals(12, kept.lineno)
        assertEquals(4, kept.colno)
        assertEquals(true, kept.isInApp)
        assertNull(kept.vars)
        assertNull(kept.contextLine)
        assertNull(kept.module)
        assertFalse(serialized(scrubbed).contains(canary))
    }

    @Test
    fun `TP-13_8 (re-review B-2) a frame with a null filename is dropped`() {
        val e = SentryEvent().apply {
            exceptions = listOf(
                SentryException().apply {
                    type = "IllegalStateException"
                    stacktrace = SentryStackTrace(listOf(frame("run", null)))
                },
            )
        }

        val frames = SentryScrubber().execute(e, Hint())!!.exceptions!!.single().stacktrace?.frames ?: emptyList()

        assertEquals(emptyList<SentryStackFrame>(), frames)
    }

    @Test
    fun `TP-13_8 (re-review B-2) tags - route loses its query, http_status 503 kept and 600 dropped, a 32-hex request_id kept`() {
        val requestId = "0123456789abcdef0123456789abcdef"
        fun scrub(vararg tags: Pair<String, String>) =
            SentryScrubber().execute(SentryEvent().apply { tags.forEach { (k, v) -> setTag(k, v) } }, Hint())!!

        val kept = scrub("route" to "/things/{id}?q=$canary", "http_status" to "503", "request_id" to requestId)
        assertEquals("/things/{id}", kept.getTag("route"))
        assertEquals("503", kept.getTag("http_status"))
        assertEquals(requestId, kept.getTag("request_id"))
        assertFalse(serialized(kept).contains(canary))

        assertNull(scrub("http_status" to "600").getTag("http_status"))
    }

    @Test
    fun `TP-13_8 (re-review B-2) a non-UUID user id gives no user`() {
        val e = SentryEvent().apply { user = User().apply { id = "user-$canary" } }

        assertNull(SentryScrubber().execute(e, Hint())!!.user)
    }
}
