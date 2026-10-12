// F-252 ApiErrorParser. TP-13.2.
package com.budmon.app.core.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiErrorParserTest {
    private fun bytes(s: String) = s.toByteArray(Charsets.UTF_8)

    @Test
    fun `TP-13_2 an envelope 404 is Defined NOT_FOUND 404`() {
        val error = ApiErrorParser.parse(
            404,
            bytes("""{"defined":true,"code":"NOT_FOUND","status":404,"message":"Not found"}"""),
        )

        assertTrue(error is ApiError.Defined)
        error as ApiError.Defined
        assertEquals("NOT_FOUND", error.key)
        assertEquals(404, error.status)
    }

    @Test
    fun `TP-13_2 a 502 HTML body is Unavailable`() {
        assertEquals(ApiError.Unavailable, ApiErrorParser.parse(502, bytes("<html>Bad Gateway</html>")))
    }

    @Test
    fun `TP-13_2 a 504 with an empty body is Unavailable`() {
        assertEquals(ApiError.Unavailable, ApiErrorParser.parse(504, ByteArray(0)))
        assertEquals(ApiError.Unavailable, ApiErrorParser.parse(504, null))
    }

    @Test
    fun `TP-13_2 a 500 non-JSON body is Defined INTERNAL 500 with no data`() {
        assertEquals(ApiError.Defined("INTERNAL", 500, null), ApiErrorParser.parse(500, bytes("oops")))
    }

    @Test
    fun `TP-13_2 a 400 non-JSON body is Unknown`() {
        assertEquals(ApiError.Unknown, ApiErrorParser.parse(400, bytes("oops")))
    }

    @Test
    fun `TP-13_2 an envelope keeps its data object`() {
        val error = ApiErrorParser.parse(
            429,
            bytes("""{"defined":true,"code":"RATE_LIMITED","status":429,"message":"x","data":{"retryAfterSeconds":125}}"""),
        ) as ApiError.Defined

        assertEquals("RATE_LIMITED", error.key)
        assertEquals("125", error.data?.get("retryAfterSeconds")?.toString())
    }
}
