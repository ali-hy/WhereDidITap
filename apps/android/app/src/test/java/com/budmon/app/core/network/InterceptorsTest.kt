// F-251 interceptors. TP-13.1.
//
// Signatures per A-344: ClientHeaderInterceptor(versionCode: Int),
// TraceparentInterceptor(random: kotlin.random.Random = Random.Default), IdempotencyKeyInterceptor(),
// and the request tag class IdempotencyKey(value: UUID).
package com.budmon.app.core.network

import java.util.UUID
import kotlin.random.Random
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class InterceptorsTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = OkHttpClient.Builder()
            .addInterceptor(ClientHeaderInterceptor(versionCode = 42))
            .addInterceptor(TraceparentInterceptor(Random(7)))
            .addInterceptor(IdempotencyKeyInterceptor())
            .build()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `TP-13_1 a request tagged IdempotencyKey carries X-Budmon-Client, traceparent and a lower-case Idempotency-Key`() {
        val key = UUID.fromString("0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b")
        server.enqueue(MockResponse().setResponseCode(200))

        client.newCall(
            Request.Builder().url(server.url("/api/v1/x")).tag(IdempotencyKey::class.java, IdempotencyKey(key)).build(),
        ).execute().close()

        val recorded = server.takeRequest()
        assertEquals("android/42", recorded.getHeader("X-Budmon-Client"))
        assertTrue(
            recorded.getHeader("traceparent").orEmpty().matches(Regex("^00-[0-9a-f]{32}-[0-9a-f]{16}-01$")),
        )
        assertEquals(key.toString(), recorded.getHeader("Idempotency-Key"))
        assertEquals(key.toString().lowercase(), recorded.getHeader("Idempotency-Key"))
    }

    @Test
    fun `TP-13_1 a request without the tag has no Idempotency-Key`() {
        server.enqueue(MockResponse().setResponseCode(200))

        client.newCall(Request.Builder().url(server.url("/api/v1/x")).build()).execute().close()

        val recorded = server.takeRequest()
        assertEquals("android/42", recorded.getHeader("X-Budmon-Client"))
        assertNull(recorded.getHeader("Idempotency-Key"))
    }

    @Test
    fun `TP-13_1 each request gets its own traceparent`() {
        server.enqueue(MockResponse().setResponseCode(200))
        server.enqueue(MockResponse().setResponseCode(200))

        repeat(2) { client.newCall(Request.Builder().url(server.url("/x")).build()).execute().close() }

        val first = server.takeRequest().getHeader("traceparent")
        val second = server.takeRequest().getHeader("traceparent")
        assertTrue(first != second)
    }
}
