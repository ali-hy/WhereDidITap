// F-260 SentryScrubber. TP-13.8.
package com.budmon.app.core.observability

import io.sentry.Hint
import io.sentry.SentryEvent
import io.sentry.protocol.Message
import io.sentry.protocol.Request
import io.sentry.protocol.SentryException
import io.sentry.protocol.User
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class SentryScrubberTest {
    // F-198's canary shape, standing in for user data.
    private val canary = "CANARY-android-tp-13-8-7f3a"

    private fun event() = SentryEvent().apply {
        request = Request().apply { url = "https://budmon.example/api/v1/things?q=$canary"; data = canary }
        setExtra("note", canary)
        user = User().apply { id = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b"; email = "$canary@example.com" }
        exceptions = listOf(SentryException().apply { type = "IllegalStateException"; value = "bad $canary" })
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
        val text = listOf(scrubbed.request, scrubbed.extras, scrubbed.user?.email, scrubbed.exceptions?.map { it.value }, scrubbed.contexts.keys).toString()
        assertFalse(text.contains(canary))
    }

    @Test
    fun `TP-13_8 an API error key stays as the exception value (A-101)`() {
        val e = SentryEvent().apply {
            exceptions = listOf(SentryException().apply { type = "ApiException"; value = "VALIDATION_FAILED" })
        }

        assertEquals("VALIDATION_FAILED", SentryScrubber().execute(e, Hint())?.exceptions?.first()?.value)
    }
}
