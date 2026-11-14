// F-202 AuthInterceptor (identity LLD §4.15, A-9). TP-0.29 (e), plus extra cases TP-0.29x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Shapes per A-9: AuthInterceptor(tokenStore: TokenStore, baseUrl: HttpUrl) in
// com.budmon.app.identity.net. The bearer goes only to the base URL's origin, on paths under
// apiRoot(baseUrl) except auth/ (auth/sign-out does get it); when it attaches it replaces an
// existing Authorization; an expired access token is still attached.
package com.budmon.app.identity.net

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.budmon.app.core.network.apiRoot
import com.budmon.app.identity.store.StoredSession
import com.budmon.app.identity.store.TokenCipher
import com.budmon.app.identity.store.TokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

@RunWith(RobolectricTestRunner::class)
class AuthInterceptorTest {
    private lateinit var server: MockWebServer
    private lateinit var other: MockWebServer
    private lateinit var baseUrl: HttpUrl
    private lateinit var client: OkHttpClient
    private val key: SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val store = TokenStore(ApplicationProvider.getApplicationContext<Context>(), TokenCipher { key })
    private val access = "bma_" + "A".repeat(43)

    private fun session(accessExpiresAt: Instant = Instant.now().plusSeconds(900)) = StoredSession(
        accessToken = access,
        refreshToken = "bmr_" + "R".repeat(43),
        accessExpiresAt = accessExpiresAt,
        refreshExpiresAt = Instant.now().plusSeconds(86_400),
        userId = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a90",
    )

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        other = MockWebServer().apply { start() }
        baseUrl = server.url("/")
        client = OkHttpClient.Builder().addInterceptor(AuthInterceptor(store, baseUrl)).build()
        runBlocking { store.resetAll() }
    }

    @After
    fun tearDown() {
        server.shutdown()
        other.shutdown()
    }

    /** Sends `request` to `target` and returns the Authorization header it received. */
    private fun authorizationOf(request: Request, target: MockWebServer = server): String? {
        target.enqueue(MockResponse().setResponseCode(200))
        client.newCall(request).execute().close()
        return target.takeRequest().getHeader("Authorization")
    }

    private fun at(path: String): Request = Request.Builder().url(apiRoot(baseUrl).resolve(path)!!).build()

    @Test
    fun `TP-0_29 (e) with a stored session, me and auth sign-out carry the bearer and auth refresh does not`() {
        runBlocking { store.save(session()) }

        assertEquals("Bearer $access", authorizationOf(at("me")))
        assertEquals("Bearer $access", authorizationOf(at("auth/sign-out")))
        assertNull(authorizationOf(at("auth/refresh")))
    }

    @Test
    fun `TP-0_29 (e) an expired access token is still attached`() {
        runBlocking { store.save(session(accessExpiresAt = Instant.now().minusSeconds(60))) }

        assertEquals("Bearer $access", authorizationOf(at("me")))
    }

    @Test
    fun `TP-0_29 (e) Bearer other is replaced by the stored token`() {
        runBlocking { store.save(session()) }
        val request = at("me").newBuilder().header("Authorization", "Bearer other").build()

        assertEquals("Bearer $access", authorizationOf(request))
    }

    @Test
    fun `TP-0_29 (e) a request to another host carries no bearer`() {
        runBlocking { store.save(session()) }
        val request = Request.Builder().url(other.url("/api/v1/me")).build()

        assertNull(authorizationOf(request, other))
    }

    @Test
    fun `TP-0_29 (e) without a stored session nothing is added`() {
        assertNull(authorizationOf(at("me")))
    }

    @Test
    fun `TP-0_29x other auth paths, and paths below auth sign-out, carry no bearer`() {
        runBlocking { store.save(session()) }

        assertNull(authorizationOf(at("auth/sign-in")))
        assertNull(authorizationOf(at("auth/sign-out/extra")))
    }

    @Test
    fun `TP-0_29x a path outside the API root carries no bearer`() {
        runBlocking { store.save(session()) }
        val request = Request.Builder().url(baseUrl.resolve("version.json")!!).build()

        assertNull(authorizationOf(request))
    }

    @Test
    fun `TP-0_29x on an excluded path an existing Authorization passes unchanged`() {
        runBlocking { store.save(session()) }
        val request = at("auth/refresh").newBuilder().header("Authorization", "Bearer other").build()

        assertEquals("Bearer other", authorizationOf(request))
    }
}
