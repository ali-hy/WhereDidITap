// F-203 TokenRefreshAuthenticator and AppModule's @Named("refreshClient") client (identity LLD §4.15,
// §8.2's S-3 signatures, A-68). TP-3.55 (a) to (l), plus TP-3.55x.
// Setup per TP-3.55: Robolectric; the real TokenStore over an in-memory key holding a session (tokens
// "O"); MockWebServer. The clients are AppModule's own: refreshClient(VERSION), and
// okHttpClient(VERSION, AuthInterceptor, the authenticator); the real AuthRepository makes the calls.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity.net

import app.cash.turbine.test
import com.budmon.app.core.di.AppModule
import com.budmon.app.core.network.ApiError
import com.budmon.app.core.network.ClientHeaderInterceptor
import com.budmon.app.core.network.TraceparentInterceptor
import com.budmon.app.identity.ApiException
import com.budmon.app.identity.AuthRepository
import com.budmon.app.identity.ME
import com.budmon.app.identity.PATH_ME
import com.budmon.app.identity.PATH_REFRESH
import com.budmon.app.identity.PATH_SIGN_IN
import com.budmon.app.identity.PATH_SIGN_OUT
import com.budmon.app.identity.PathDispatcher
import com.budmon.app.identity.PendingSignIn
import com.budmon.app.identity.SessionEvent
import com.budmon.app.identity.SessionEvents
import com.budmon.app.identity.WireTokens
import com.budmon.app.identity.definedError
import com.budmon.app.identity.gateway503
import com.budmon.app.identity.jsonResponse
import com.budmon.app.identity.meJson
import com.budmon.app.identity.refreshJson
import com.budmon.app.identity.store.TokenStore
import com.budmon.app.identity.testTokenStore
import com.budmon.app.identity.unauthenticated
import com.budmon.app.identity.wireTokens
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Authenticator
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val VERSION = 7

@RunWith(RobolectricTestRunner::class)
class TokenRefreshAuthenticatorTest {
    private val server = MockWebServer()
    private val http = PathDispatcher()
    private val store: TokenStore = testTokenStore()
    private val events = SessionEvents()
    private val old: WireTokens = wireTokens('O')
    private val new: WireTokens = wireTokens('N', deviceToken = null)
    private val oldSession = old.stored(userId = ME.id)
    private lateinit var baseUrl: HttpUrl
    private lateinit var refreshClient: OkHttpClient
    private lateinit var authenticator: TokenRefreshAuthenticator
    private lateinit var client: OkHttpClient
    private lateinit var repository: AuthRepository

    @Before
    fun setUp() {
        runBlocking {
            store.resetAll()
            store.save(oldSession)
        }
        // `me` answers 200 for the new token and 401 UNAUTHENTICATED for any other; refresh 200.
        http.answers[PATH_ME] = { request ->
            if (request.authorization == "Bearer ${new.accessToken}") jsonResponse(meJson()) else unauthenticated()
        }
        http.answers[PATH_REFRESH] = { jsonResponse(refreshJson(new)) }
        server.dispatcher = http
        server.start()
        baseUrl = server.url("/")
        refreshClient = AppModule.refreshClient(VERSION)
        authenticator = TokenRefreshAuthenticator(store, refreshClient, baseUrl, events)
        client = AppModule.okHttpClient(VERSION, AuthInterceptor(store, baseUrl), authenticator)
        repository = AuthRepository(client, baseUrl, store, mockk(relaxed = true))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    /** The ApiException [block] throws. */
    private suspend fun apiErrorOf(block: suspend () -> Unit): ApiError {
        try {
            block()
        } catch (e: ApiException) {
            return e.error
        }
        fail("expected an ApiException")
        error("unreachable")
    }

    private fun bearers(): List<String?> = http.of(PATH_ME).map { it.authorization }

    @Test
    fun `TP-3_55 (a) me 401 UNAUTHENTICATED, refresh 200 - one refresh with body delivery, client header, no Authorization, saved, retried with the new token`() =
        runBlocking {
            val me = repository.getMe()

            assertEquals(ME, me)
            val refresh = http.of(PATH_REFRESH).single()
            assertEquals("POST", refresh.method)
            val expectedBody = buildJsonObject {
                put("tokenDelivery", "body")
                put("refreshToken", old.refreshToken)
            }
            assertEquals(expectedBody, Json.parseToJsonElement(refresh.body))
            assertEquals("android/$VERSION", refresh.client)
            assertNull(refresh.authorization)
            assertEquals(new.stored(userId = ME.id), store.read())
            assertEquals(listOf("Bearer ${old.accessToken}", "Bearer ${new.accessToken}"), bearers())
        }

    @Test
    fun `TP-3_55 (b) two parallel requests both answered 401 - one refresh, both retried`() = runBlocking {
        val bothArrived = CountDownLatch(2)
        http.answers[PATH_ME] = { request ->
            if (request.authorization == "Bearer ${new.accessToken}") {
                jsonResponse(meJson())
            } else {
                bothArrived.countDown()
                bothArrived.await(5, TimeUnit.SECONDS)
                unauthenticated()
            }
        }

        val results = listOf(
            async(Dispatchers.IO) { repository.getMe() },
            async(Dispatchers.IO) { repository.getMe() },
        ).awaitAll()

        assertEquals(listOf(ME, ME), results)
        assertEquals(1, http.of(PATH_REFRESH).size)
        assertEquals(2, bearers().count { it == "Bearer ${old.accessToken}" })
        assertEquals(2, bearers().count { it == "Bearer ${new.accessToken}" })
    }

    @Test
    fun `TP-3_55 (c) a 401 for a request whose token is older than the stored one - retried with the stored token, no refresh`() =
        runBlocking {
            // Another refresh stores the new session while this request is answered.
            http.answers[PATH_ME] = { request ->
                if (request.authorization == "Bearer ${new.accessToken}") {
                    jsonResponse(meJson())
                } else {
                    runBlocking { store.save(new.stored(userId = ME.id)) }
                    unauthenticated()
                }
            }

            val me = repository.getMe()

            assertEquals(ME, me)
            assertTrue(http.of(PATH_REFRESH).isEmpty())
            assertEquals(listOf("Bearer ${old.accessToken}", "Bearer ${new.accessToken}"), bearers())
        }

    @Test
    fun `TP-3_55 (d) refresh 401 REFRESH_INVALID - cleared, Ended emitted, the 401 returned to the caller`() = runBlocking {
        http.answers[PATH_REFRESH] = { definedError("REFRESH_INVALID", 401) }

        events.events.test {
            val error = apiErrorOf { repository.getMe() }

            assertEquals("UNAUTHENTICATED", (error as ApiError.Defined).key)
            assertEquals(SessionEvent.Ended, awaitItem())
            expectNoEvents()
        }
        assertNull(store.read())
        assertEquals(1, http.of(PATH_REFRESH).size)
        assertEquals(1, http.of(PATH_ME).size)
    }

    @Test
    fun `TP-3_55 (e) the retried request answered 401 again - no second refresh`() = runBlocking {
        http.answers[PATH_ME] = { unauthenticated() }

        val error = apiErrorOf { repository.getMe() }

        assertEquals("UNAUTHENTICATED", (error as ApiError.Defined).key)
        assertEquals(1, http.of(PATH_REFRESH).size)
        assertEquals(listOf("Bearer ${old.accessToken}", "Bearer ${new.accessToken}"), bearers())
    }

    @Test
    fun `TP-3_55 (f) a 401 whose body isn't an UNAUTHENTICATED envelope - returned unchanged, no refresh`() = runBlocking {
        val answers = listOf(
            { MockResponse().setResponseCode(401).setBody("Unauthorized") },
            { definedError("INVALID_CREDENTIALS", 401) },
        )
        for ((index, answer) in answers.withIndex()) {
            http.seen.clear()
            http.answers[PATH_ME] = { answer() }

            val error = apiErrorOf { repository.getMe() }

            assertEquals("case $index", 1, http.of(PATH_ME).size)
            assertTrue("case $index", http.of(PATH_REFRESH).isEmpty())
            assertEquals("case $index", oldSession, store.read())
            if (index == 1) assertEquals(ApiError.Defined("INVALID_CREDENTIALS", 401, null), error)
        }
    }

    @Test
    fun `TP-3_55 (g) refresh 503 - the session kept, nothing emitted, getMe throws ApiException(Unavailable)`() = runBlocking {
        http.answers[PATH_REFRESH] = { gateway503() }

        events.events.test {
            val error = apiErrorOf { repository.getMe() }

            assertEquals(ApiError.Unavailable, error)
            expectNoEvents()
        }
        assertEquals(oldSession, store.read())
    }

    @Test
    fun `TP-3_55 (h) the refresh connection fails - the session kept, nothing emitted, ApiException(Network)`() = runBlocking {
        // DISCONNECT_AT_START is read through Dispatcher.peek(), which PathDispatcher doesn't override;
        // DISCONNECT_AFTER_REQUEST applies to a dispatched response.
        http.answers[PATH_REFRESH] = { MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST) }

        events.events.test {
            val error = apiErrorOf { repository.getMe() }

            assertEquals(ApiError.Network, error)
            expectNoEvents()
        }
        assertEquals(oldSession, store.read())
    }

    @Test
    fun `TP-3_55 (i) no stored session - no refresh request, the 401 returned`() = runBlocking {
        store.resetAll()

        val error = apiErrorOf { repository.getMe() }

        assertEquals("UNAUTHENTICATED", (error as ApiError.Defined).key)
        assertTrue(http.of(PATH_REFRESH).isEmpty())
        assertEquals(1, http.of(PATH_ME).size)
    }

    // ---- additions ----

    @Test
    fun `TP-3_55x refresh 429 RATE_LIMITED - the session kept, nothing emitted, ApiException(RATE_LIMITED)`() = runBlocking {
        http.answers[PATH_REFRESH] = { definedError("RATE_LIMITED", 429, """{"retryAfterSeconds":60}""") }

        events.events.test {
            val error = apiErrorOf { repository.getMe() }

            assertEquals("RATE_LIMITED", (error as ApiError.Defined).key)
            expectNoEvents()
        }
        assertEquals(oldSession, store.read())
    }

    @Test
    fun `TP-3_55x a refresh 200 with a deviceToken saves it for lastEmail()`() = runBlocking {
        store.saveLastEmail(ME.email)
        val withDevice = wireTokens('N', deviceToken = "bmd_" + "V".repeat(43))
        http.answers[PATH_REFRESH] = { jsonResponse(refreshJson(withDevice)) }

        repository.getMe()

        assertEquals(withDevice.deviceToken, store.deviceTokenFor(ME.email))
        assertEquals(withDevice.stored(userId = ME.id), store.read())
    }

    @Test
    fun `TP-3_55 (j) sign-out 401 UNAUTHENTICATED, refresh 200, retried sign-out 200 - one refresh, retried with the new token, then signOut clears the session (A-81)`() =
        runBlocking {
            http.answers[PATH_SIGN_OUT] = { request ->
                if (request.authorization == "Bearer ${new.accessToken}") jsonResponse("""{"ok":true}""") else unauthenticated()
            }

            repository.signOut()

            assertEquals(1, http.of(PATH_REFRESH).size)
            assertEquals(
                listOf("Bearer ${old.accessToken}", "Bearer ${new.accessToken}"),
                http.of(PATH_SIGN_OUT).map { it.authorization },
            )
            assertNull(store.read())
        }

    @Test
    fun `TP-3_55 (k) sign-out 401 UNAUTHENTICATED, refresh REFRESH_INVALID - cleared, no Ended, signOut returns normally (A-87)`() =
        runBlocking {
            http.answers[PATH_SIGN_OUT] = { unauthenticated() }
            http.answers[PATH_REFRESH] = { definedError("REFRESH_INVALID", 401) }

            events.events.test {
                repository.signOut()

                expectNoEvents()
            }
            assertEquals(1, http.of(PATH_REFRESH).size)
            assertEquals(1, http.of(PATH_SIGN_OUT).size)
            assertNull(store.read())
        }

    @Test
    fun `TP-3_55 (l) explicit-token getMe and abandonSignIn answered 401 - no refresh, no retry with the stored token, S kept (A-95)`() =
        runBlocking {
            val other = wireTokens('X')
            val pending = PendingSignIn(session = other.stored(userId = ME.id), deviceToken = null, me = ME)
            http.answers[PATH_SIGN_OUT] = { unauthenticated() }

            val error = apiErrorOf { repository.getMe(accessToken = other.accessToken) }
            repository.abandonSignIn(pending)

            assertEquals("UNAUTHENTICATED", (error as ApiError.Defined).key)
            assertTrue(http.of(PATH_REFRESH).isEmpty())
            assertEquals(listOf("Bearer ${other.accessToken}"), bearers())
            assertEquals(listOf("Bearer ${other.accessToken}"), http.of(PATH_SIGN_OUT).map { it.authorization })
            assertTrue(http.seen.none { it.authorization == "Bearer ${old.accessToken}" })
            assertEquals(oldSession, store.read())
        }

    @Test
    fun `TP-3_55x a 401 UNAUTHENTICATED from auth-sign-in - no refresh (A-81 keeps the other auth- exclusions)`() = runBlocking {
        http.answers[PATH_SIGN_IN] = { unauthenticated() }

        apiErrorOf { repository.signIn(ME.email, "violet staircase umbrella") }

        assertTrue(http.of(PATH_REFRESH).isEmpty())
        assertEquals(1, http.of(PATH_SIGN_IN).size)
    }

    @Test
    fun `TP-3_55x refreshClient has only the client header and traceparent interceptors and no authenticator, the main client uses F-203`() {
        assertEquals(
            listOf(ClientHeaderInterceptor::class, TraceparentInterceptor::class),
            refreshClient.interceptors.map { it::class },
        )
        assertSame(Authenticator.NONE, refreshClient.authenticator)
        assertSame(authenticator, client.authenticator)
    }

    @Test
    fun `TP-3_55x RefreshFailedException is an IOException whose message is the key or kind, never data`() {
        val defined = ApiError.Defined("RATE_LIMITED", 429, buildJsonObject { put("email", JsonPrimitive("a@x.test")) })

        val byKey = RefreshFailedException(defined)
        val byKind = RefreshFailedException(ApiError.Unavailable)

        assertTrue(IOException::class.java.isAssignableFrom(RefreshFailedException::class.java))
        assertEquals(defined, byKey.error)
        assertEquals("refresh failed: RATE_LIMITED", byKey.message)
        assertEquals("refresh failed: Unavailable", byKind.message)
    }
}
