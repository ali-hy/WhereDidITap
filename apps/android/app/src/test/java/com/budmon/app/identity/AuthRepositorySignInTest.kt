// F-204's sign-in and sign-out, F-205 OutboxOwnerGuard (identity LLD §4.15, §8.2's S-3 signatures,
// A-69). TP-3.48 (a) to (j), plus TP-3.48x.
// Setup per TP-3.48: Robolectric; MockWebServer; the real AuthRepository and TokenStore (in-memory
// key, resetAll() first). The repository's client carries F-202, as AppModule's does. The guard gets
// a MockK OutboxDao (countAll over `entries`, deleteAll) and a relaxed MockK OutboxRepository.
// X is ME; Y another user. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import com.budmon.app.core.network.ApiError
import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.core.outbox.OutboxRepository
import com.budmon.app.identity.net.AuthInterceptor
import com.budmon.app.identity.store.TokenStore
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant

private const val PASSWORD = "violet staircase umbrella"

@RunWith(RobolectricTestRunner::class)
class AuthRepositorySignInTest {
    private val server = MockWebServer()
    private val http = PathDispatcher()
    private val store: TokenStore = testTokenStore()

    /** The outbox's entry count, as countAll() reports it; deleteAll() empties it. */
    private var entries = 0
    private val dao = mockk<OutboxDao> {
        coEvery { countAll() } answers { entries }
        coEvery { deleteAll() } answers {
            val n = entries
            entries = 0
            n
        }
    }
    private val outbox = mockk<OutboxRepository>(relaxed = true)
    private lateinit var baseUrl: HttpUrl
    private lateinit var repository: AuthRepository
    private lateinit var guard: OutboxOwnerGuard

    private val y = Me(
        id = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a77",
        email = "yara@example.com",
        displayName = "Yara Adel",
        locale = "en",
        timeZone = "Africa/Cairo",
        baseCurrency = "EGP",
        status = "active",
        isOwner = false,
    )
    private val tokensX = wireTokens('X')
    private val tokensY = wireTokens('Y')

    /** Who the server signs in and what `me` answers (by the bearer's tokens). */
    private var signInTokens = tokensX
    private val meByAccess = mutableMapOf(tokensX.accessToken to ME, tokensY.accessToken to y)

    @Before
    fun setUp() {
        runBlocking { store.resetAll() }
        http.answers[PATH_SIGN_IN] = { jsonResponse(signedInJson(signInTokens)) }
        http.answers[PATH_ME] = { request ->
            val me = meByAccess[request.authorization?.removePrefix("Bearer ")]
            if (me == null) unauthenticated() else jsonResponse(meJson(me))
        }
        http.answers[PATH_SIGN_OUT] = { jsonResponse("""{"ok":true}""") }
        server.dispatcher = http
        server.start()
        baseUrl = server.url("/")
        val client = OkHttpClient.Builder().addInterceptor(AuthInterceptor(store, baseUrl)).build()
        repository = AuthRepository(client, baseUrl, store, mockk(relaxed = true))
        guard = OutboxOwnerGuard(dao, store, outbox, repository)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun body(request: SeenRequest): JsonObject = Json.parseToJsonElement(request.body).jsonObject

    private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content

    /** signIn, expecting `signed_in`. */
    private suspend fun pendingFor(email: String, tokens: WireTokens): PendingSignIn {
        signInTokens = tokens
        val outcome = repository.signIn(email, PASSWORD)
        return (outcome as SignInOutcome.Ready).pending
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

    // ---- F-204 sign-in and F-205 complete ----

    @Test
    fun `TP-3_48 (a) signIn then complete with no entries - body delivery, model, no deviceToken, me with the new token, Proceed, all stored, kick once`() =
        runBlocking {
            val pending = pendingFor(ME.email, tokensX)

            val decision = guard.complete(pending)

            val signIn = body(http.of(PATH_SIGN_IN).single())
            assertEquals("body", signIn.text("tokenDelivery"))
            assertTrue(signIn.text("deviceModel").isNotEmpty())
            assertFalse("no deviceToken while none is stored", signIn.containsKey("deviceToken"))
            assertEquals(ME.email, signIn.text("email"))
            assertEquals(PASSWORD, signIn.text("password"))
            assertEquals("Bearer ${tokensX.accessToken}", http.of(PATH_ME).single().authorization)
            assertEquals(ME, pending.me)
            assertEquals(ME.id, pending.session.userId)
            assertEquals(tokensX.deviceToken, pending.deviceToken)
            assertEquals(OwnerDecision.Proceed, decision)
            assertEquals(tokensX.stored(userId = ME.id), store.read())
            assertEquals(tokensX.deviceToken, store.deviceTokenFor(ME.email))
            assertEquals(ME.email, store.lastEmail())
            verify(exactly = 1) { outbox.kick() }
        }

    @Test
    fun `TP-3_48x signIn alone stores nothing - no session, device token or last email before the owner check`() = runBlocking {
        pendingFor(ME.email, tokensX)

        assertNull(store.read())
        assertNull(store.deviceTokenFor(ME.email))
        assertNull(store.lastEmail())
        verify(exactly = 0) { outbox.kick() }
    }

    @Test
    fun `TP-3_48 (b) signOut - POST auth-sign-out with the stored token, session cleared, device token, last email and owner kept`() =
        runBlocking {
            guard.complete(pendingFor(ME.email, tokensX))

            repository.signOut()

            val signOut = http.of(PATH_SIGN_OUT).single()
            assertEquals("POST", signOut.method)
            assertEquals("Bearer ${tokensX.accessToken}", signOut.authorization)
            assertNull(store.read())
            assertEquals(tokensX.deviceToken, store.deviceTokenFor(ME.email))
            assertEquals(ME.email, store.lastEmail())
            assertEquals(ME.id, store.outboxOwnerUserId())
        }

    @Test
    fun `TP-3_48 (c) signIn again with the same email - the body carries the stored deviceToken`() = runBlocking {
        guard.complete(pendingFor(ME.email, tokensX))
        repository.signOut()

        pendingFor(ME.email, tokensX)

        val second = body(http.of(PATH_SIGN_IN)[1])
        assertEquals(tokensX.deviceToken, second.text("deviceToken"))
    }

    @Test
    fun `TP-3_48 (d) 3 entries owned by X, sign in as Y - AskDiscard(3), nothing stored, no kick`() = runBlocking {
        entries = 3
        store.setOutboxOwnerUserId(ME.id)

        val decision = guard.complete(pendingFor(y.email, tokensY))

        assertEquals(OwnerDecision.AskDiscard(3), decision)
        assertNull(store.read())
        assertNull(store.deviceTokenFor(y.email))
        assertNull(store.lastEmail())
        assertEquals(ME.id, store.outboxOwnerUserId())
        coVerify(exactly = 0) { dao.deleteAll() }
        verify(exactly = 0) { outbox.kick() }
    }

    @Test
    fun `TP-3_48 (e) owner null with 2 entries, sign in as X - AskDiscard(2)`() = runBlocking {
        entries = 2

        val decision = guard.complete(pendingFor(ME.email, tokensX))

        assertEquals(OwnerDecision.AskDiscard(2), decision)
        assertNull(store.read())
        verify(exactly = 0) { outbox.kick() }
    }

    @Test
    fun `TP-3_48 (f) no entries and owner null - Proceed, owner set to X`() = runBlocking {
        val decision = guard.complete(pendingFor(ME.email, tokensX))

        assertEquals(OwnerDecision.Proceed, decision)
        assertEquals(ME.id, store.outboxOwnerUserId())
    }

    @Test
    fun `TP-3_48x no entries and owner another user - Proceed, owner set to X, session stored`() = runBlocking {
        store.setOutboxOwnerUserId(y.id)

        val decision = guard.complete(pendingFor(ME.email, tokensX))

        assertEquals(OwnerDecision.Proceed, decision)
        assertEquals(ME.id, store.outboxOwnerUserId())
        assertEquals(tokensX.stored(userId = ME.id), store.read())
    }

    @Test
    fun `TP-3_48x entries owned by the same user - Proceed, nothing deleted, session stored, kick once`() = runBlocking {
        entries = 4
        store.setOutboxOwnerUserId(ME.id)

        val decision = guard.complete(pendingFor(ME.email, tokensX))

        assertEquals(OwnerDecision.Proceed, decision)
        coVerify(exactly = 0) { dao.deleteAll() }
        assertEquals(tokensX.stored(userId = ME.id), store.read())
        verify(exactly = 1) { outbox.kick() }
    }

    @Test
    fun `TP-3_48 (g) after (d), discardAndProceed - deleteAll called, owner Y, session stored, kick`() = runBlocking {
        entries = 3
        store.setOutboxOwnerUserId(ME.id)
        val pending = pendingFor(y.email, tokensY)
        guard.complete(pending)

        guard.discardAndProceed(pending)

        coVerify(exactly = 1) { dao.deleteAll() }
        assertEquals(y.id, store.outboxOwnerUserId())
        assertEquals(tokensY.stored(userId = y.id), store.read())
        assertEquals(tokensY.deviceToken, store.deviceTokenFor(y.email))
        assertEquals(y.email, store.lastEmail())
        verify(exactly = 1) { outbox.kick() }
    }

    @Test
    fun `TP-3_48 (h) after (d), cancel - POST auth-sign-out with Y's pending token, entries and owner X unchanged, nothing stored`() =
        runBlocking {
            entries = 3
            store.setOutboxOwnerUserId(ME.id)
            val pending = pendingFor(y.email, tokensY)
            guard.complete(pending)

            guard.cancel(pending)

            val signOut = http.of(PATH_SIGN_OUT).single()
            assertEquals("POST", signOut.method)
            assertEquals("Bearer ${tokensY.accessToken}", signOut.authorization)
            coVerify(exactly = 0) { dao.deleteAll() }
            assertEquals(3, entries)
            assertEquals(ME.id, store.outboxOwnerUserId())
            assertNull(store.read())
            verify(exactly = 0) { outbox.kick() }
        }

    // ---- F-204 failures ----

    @Test
    fun `TP-3_48 (i) me answering 503 right after a 200 sign-in - ApiException(Unavailable), a sign-out with the pending token, nothing stored`() =
        runBlocking {
            http.answers[PATH_ME] = { gateway503() }

            val error = apiErrorOf { repository.signIn(ME.email, PASSWORD) }

            assertEquals(ApiError.Unavailable, error)
            assertEquals("Bearer ${tokensX.accessToken}", http.of(PATH_SIGN_OUT).single().authorization)
            assertNull(store.read())
        }

    @Test
    fun `TP-3_48x me failing after sign-in and the best-effort sign-out failing too - me's error is thrown`() = runBlocking {
        http.answers[PATH_ME] = { definedError("INTERNAL", 500) }
        http.answers[PATH_SIGN_OUT] = { gateway503() }

        val error = apiErrorOf { repository.signIn(ME.email, PASSWORD) }

        assertEquals("INTERNAL", (error as ApiError.Defined).key)
        assertEquals(1, http.of(PATH_SIGN_OUT).size)
        assertNull(store.read())
    }

    @Test
    fun `TP-3_48 (j) signOut answered 503 - ApiException(Unavailable), the session still stored`() = runBlocking {
        guard.complete(pendingFor(ME.email, tokensX))
        http.answers[PATH_SIGN_OUT] = { gateway503() }

        val error = apiErrorOf { repository.signOut() }

        assertEquals(ApiError.Unavailable, error)
        assertEquals(tokensX.stored(userId = ME.id), store.read())
    }

    @Test
    fun `TP-3_48x signOut answered 401 UNAUTHENTICATED - the session is cleared, nothing thrown`() = runBlocking {
        guard.complete(pendingFor(ME.email, tokensX))
        http.answers[PATH_SIGN_OUT] = { unauthenticated() }

        repository.signOut()

        assertNull(store.read())
        assertEquals(ME.email, store.lastEmail())
    }

    @Test
    fun `TP-3_48x signIn INVALID_CREDENTIALS - that ApiException, no me request, nothing stored`() = runBlocking {
        http.answers[PATH_SIGN_IN] = { definedError("INVALID_CREDENTIALS", 401) }

        val error = apiErrorOf { repository.signIn(ME.email, PASSWORD) }

        assertEquals(ApiError.Defined("INVALID_CREDENTIALS", 401, null), error)
        assertTrue(http.of(PATH_ME).isEmpty())
        assertNull(store.read())
    }

    @Test
    fun `TP-3_48x signIn two_step_required - TwoStepRequired(challengeToken, expiresAt), no me request, nothing stored`() = runBlocking {
        val challenge = "bmc_" + "C".repeat(43)
        http.answers[PATH_SIGN_IN] = {
            jsonResponse("""{"status":"two_step_required","challengeToken":"$challenge","expiresAt":"2026-11-15T10:05:00.000Z"}""")
        }

        val outcome = repository.signIn(ME.email, PASSWORD)

        assertEquals(SignInOutcome.TwoStepRequired(challenge, Instant.parse("2026-11-15T10:05:00Z")), outcome)
        assertTrue(http.of(PATH_ME).isEmpty())
        assertNull(store.read())
    }

    @Test
    fun `TP-3_48x signIn trims the email in the body`() = runBlocking {
        pendingFor("  ${ME.email} ", tokensX)

        assertEquals(ME.email, body(http.of(PATH_SIGN_IN).single()).text("email"))
    }

    @Test
    fun `TP-3_48x a 2xx sign-in answer that isn't JSON - ApiException(Unknown)`() = runBlocking {
        http.answers[PATH_SIGN_IN] = { MockResponse().setResponseCode(200).setBody("<html>") }

        assertEquals(ApiError.Unknown, apiErrorOf { repository.signIn(ME.email, PASSWORD) })
        assertNull(store.read())
    }
}
