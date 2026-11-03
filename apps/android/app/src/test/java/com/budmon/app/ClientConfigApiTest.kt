// The generated client against meta/client-config (§5.2). TP-13.12.
//
// Assumed: the generated MetaApi (packageName com.budmon.api) is built with Retrofit and the
// kotlinx.serialization converter, as F-264 wires it.
package com.budmon.app

import com.budmon.api.apis.MetaApi
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.Retrofit

class ClientConfigApiTest {
    @Test
    fun `TP-13_12 clientConfig parses section 5_2's body, with downloadUrl null`() = runTest {
        val server = MockWebServer()
        server.enqueue(
            MockResponse().setHeader("Content-Type", "application/json").setBody(
                """{ "apiVersion": "1.0", "android": { "minimumVersionCode": 0, "latestVersionCode": 0, "downloadUrl": null }, "web": { "minimumBuild": 0 } }""",
            ),
        )
        server.start()
        try {
            val api = Retrofit.Builder()
                .baseUrl(server.url("/api/v1/"))
                .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
                .build()
                .create(MetaApi::class.java)

            val body = api.metaClientConfig().body()!!

            assertEquals("1.0", body.apiVersion)
            assertEquals(0, body.android.minimumVersionCode)
            assertEquals(0, body.android.latestVersionCode)
            assertNull(body.android.downloadUrl)
            assertEquals(0, body.web.minimumBuild)
            assertEquals("/api/v1/meta/client-config", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }
}
