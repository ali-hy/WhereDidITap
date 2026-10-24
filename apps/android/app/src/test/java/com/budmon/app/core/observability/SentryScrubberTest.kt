// F-260 SentryScrubber. TP-13.8.
package com.budmon.app.core.observability

import io.sentry.Breadcrumb
import io.sentry.Hint
import io.sentry.JsonSerializer
import io.sentry.SentryEvent
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
    fun `TP-13_8 (B-8) an http breadcrumb keeps url as scheme, host and path, no query or userinfo, plus method and status`() {
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
        assertEquals("https://budmon.example/api/v1/things", kept!!.getData("url"))
        assertEquals("GET", kept.getData("method"))
        assertEquals(200, kept.getData("status_code"))
        assertEquals(setOf("url", "method", "status_code"), kept.data.keys)
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
    }

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
