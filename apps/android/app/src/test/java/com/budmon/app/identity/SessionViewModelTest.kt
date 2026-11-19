// F-207 SessionViewModel (identity LLD §4.15, A-37, A-68, A-101). TP-3.49 rows (a) to (i), and S-3's
// rows (k) to (m); row (j) is SessionNotLoadedTest. Plus extra cases TP-3.49x. S-4: TP-4.41 row (f),
// onMeUpdated, plus TP-4.41x.
//
// Setup per TP-3.49: the real TokenStore over an in-memory key (resetAll() first; "clear()" is
// checked as read() == null); Clock.fixed; a MockK ConnectivityMonitor over a MutableStateFlow; a real
// SessionEvents; the ViewModel built as SessionViewModel(repository, tokenStore, connectivity, clock,
// sessionEvents, backgroundScope) (S-3, A-68), then onForeground(). Rows (a) to (c), (i), (k) and (l)
// use MockWebServer and the real AuthRepository ((k) and (l) over F-202 and F-203, as AppModule's
// client); rows (d) to (h) a MockK AuthRepository whose getMe() follows a script, each answer after
// PROBE_MS of virtual time.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import com.budmon.app.core.network.ApiError
import com.budmon.app.core.network.ConnectivityMonitor
import com.budmon.app.identity.net.AuthInterceptor
import com.budmon.app.identity.net.TokenRefreshAuthenticator
import com.budmon.app.identity.store.TokenStore
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

private const val PROBE_MS = 100L

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class SessionViewModelTest {
    private val now: Instant = Instant.parse("2026-11-15T10:00:00Z")
    private val clock: Clock = Clock.fixed(now, ZoneOffset.UTC)
    private val store: TokenStore = testTokenStore()
    private val online = MutableStateFlow(true)
    private val connectivity = mockk<ConnectivityMonitor> { every { isOnline } returns online }
    private val server = MockWebServer()
    private val sessionEvents = SessionEvents()

    /** The scripted getMe(): each call takes the next answer (the last one repeats). */
    private val script = ArrayDeque<suspend () -> Me>()
    private var probes = 0
    private val scripted = mockk<AuthRepository> {
        coEvery { getMe() } coAnswers {
            probes += 1
            val answer = if (script.size > 1) script.removeFirst() else script.first()
            answer()
        }
    }

    private fun fails(error: ApiError, after: Long = PROBE_MS): suspend () -> Me = {
        delay(after)
        throw ApiException(error)
    }

    private fun answersMe(after: Long = PROBE_MS): suspend () -> Me = {
        delay(after)
        ME
    }

    @Before
    fun setUp() = runBlocking {
        store.resetAll()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun TestScope.viewModel(repository: AuthRepository): SessionViewModel =
        SessionViewModel(repository, store, connectivity, clock, sessionEvents, backgroundScope).also { it.onForeground() }

    private fun realRepository() = AuthRepository(OkHttpClient(), server.url("/"), store, mockk(relaxed = true))

    /** The real repository over F-202 and F-203 (S-3), as AppModule's client. */
    private fun refreshingRepository(): AuthRepository {
        val base = server.url("/")
        val authenticator = TokenRefreshAuthenticator(store, OkHttpClient(), base, sessionEvents)
        val client = OkHttpClient.Builder().addInterceptor(AuthInterceptor(store, base)).authenticator(authenticator).build()
        return AuthRepository(client, base, store, mockk(relaxed = true))
    }

    /** Every state [vm] takes from now on. */
    private fun TestScope.statesOf(vm: SessionViewModel): List<SessionUiState> {
        val states = mutableListOf<SessionUiState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.state.toList(states) }
        return states
    }

    private suspend fun SessionViewModel.settled(): SessionUiState =
        state.first { it !is SessionUiState.Loading }

    /**
     * The first state other than [after], reached with no further virtual time, so a probe that
     * answered within the time already advanced is what set it.
     * - A successful probe reads (and may rewrite) the stored session on DataStore's real thread
     *   before it sets the state, so virtual time alone can't reach it.
     */
    private suspend fun TestScope.next(vm: SessionViewModel, after: SessionUiState): SessionUiState {
        val at = testScheduler.currentTime
        val state = vm.state.first { it != after }
        assertEquals("no virtual time passed while waiting", at, testScheduler.currentTime)
        return state
    }

    /** Exactly one new probe after `seconds` (none a millisecond before), which then fails. */
    private fun TestScope.expectNextProbeAfter(seconds: Long) {
        val before = probes
        advanceTimeBy(seconds * 1_000 - 1)
        runCurrent()
        assertEquals("no probe before ${seconds}s", before, probes)
        advanceTimeBy(1)
        runCurrent()
        assertEquals("one probe at ${seconds}s", before + 1, probes)
        advanceTimeBy(PROBE_MS)
        runCurrent()
    }

    private fun TestScope.idleFor(ms: Long) {
        advanceTimeBy(ms)
        runCurrent()
    }

    // ---- MockWebServer rows ----

    @Test
    fun `TP-3_49 (a) no stored session - SignedOut`() = runTest {
        server.start()

        val vm = viewModel(realRepository())

        assertEquals(SessionUiState.SignedOut(SignedOutReason.None), vm.settled())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `TP-3_49 (b) a stored session and me 200 - SignedIn(me)`() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(meJson()))
        server.start()
        store.save(storedSession(now.plusSeconds(3600)))

        val vm = viewModel(realRepository())

        assertEquals(SessionUiState.SignedIn(ME), vm.settled())
        assertEquals("/api/v1/me", server.takeRequest().path)
    }

    @Test
    fun `TP-3_49x a probe's 200 fills a missing userId in the stored session`() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(meJson()))
        server.start()
        store.save(storedSession(now.plusSeconds(3600), userId = ""))

        val vm = viewModel(realRepository())
        vm.settled()

        assertEquals(ME.id, store.read()?.userId)
    }

    @Test
    fun `TP-3_49 (c) a stored session whose refreshExpiresAt is the clock - cleared and SignedOut(Ended), no request`() = runTest {
        server.start()
        store.save(storedSession(now))

        val vm = viewModel(realRepository())

        assertEquals(SessionUiState.SignedOut(SignedOutReason.Ended), vm.settled())
        assertNull(store.read())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `TP-3_49 (i) me 401 UNAUTHENTICATED - cleared and SignedOut(Ended)`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(401).setHeader("Content-Type", "application/json").setBody(
                """{"defined":true,"code":"UNAUTHENTICATED","status":401,"message":"Authentication required"}""",
            ),
        )
        server.start()
        store.save(storedSession(now.plusSeconds(3600)))

        val vm = viewModel(realRepository())

        assertEquals(SessionUiState.SignedOut(SignedOutReason.Ended), vm.settled())
        assertNull(store.read())
    }

    // ---- scripted rows (virtual time) ----

    @Test
    fun `TP-3_49 (d) Network online, then offline - no probe, back online - exactly one probe, then SignedIn(me)`() = runTest {
        store.save(storedSession(now.plusSeconds(3600)))
        script.add(fails(ApiError.Network))
        val vm = viewModel(scripted)

        assertEquals(SessionUiState.SignedIn(null, ApiError.Network), vm.settled())
        assertEquals(1, probes)

        online.value = false
        idleFor(10 * 60 * 1_000)
        assertEquals("no probe while offline", 1, probes)

        script.clear()
        script.add(answersMe())
        online.value = true
        runCurrent()
        assertEquals("one probe when back online", 2, probes)
        idleFor(PROBE_MS)
        assertEquals(SessionUiState.SignedIn(ME), next(vm, after = SessionUiState.SignedIn(null, ApiError.Network)))
        idleFor(10 * 60 * 1_000)
        assertEquals("no probe once signed in", 2, probes)
    }

    @Test
    fun `TP-3_49 (e) Timeout every time online - one probe after 15, 30, 60, 120, 240, 300 and 300 s, none between`() = runTest {
        store.save(storedSession(now.plusSeconds(3600)))
        script.add(fails(ApiError.Timeout))
        val vm = viewModel(scripted)

        assertEquals(SessionUiState.SignedIn(null, ApiError.Timeout), vm.settled())
        assertEquals(1, probes)
        for (seconds in listOf(15L, 30L, 60L, 120L, 240L, 300L, 300L)) expectNextProbeAfter(seconds)

        assertEquals("7 probes after the first", 8, probes)
        assertEquals(SessionUiState.SignedIn(null, ApiError.Timeout), vm.state.value)
    }

    @Test
    fun `TP-3_49 (f) after backoff, offline 10 minutes - no probe, back online - one probe, then 15 s again`() = runTest {
        store.save(storedSession(now.plusSeconds(3600)))
        script.add(fails(ApiError.Timeout))
        val vm = viewModel(scripted)
        vm.settled()
        expectNextProbeAfter(15)
        expectNextProbeAfter(30)

        online.value = false
        idleFor(10 * 60 * 1_000)
        assertEquals("no probe while offline", 3, probes)

        online.value = true
        runCurrent()
        assertEquals("one probe when back online", 4, probes)
        idleFor(PROBE_MS)
        expectNextProbeAfter(15)
    }

    @Test
    fun `TP-3_49 (g) Network, background 10 minutes - no probe, onForeground with me 200 - one probe, SignedIn(me)`() = runTest {
        store.save(storedSession(now.plusSeconds(3600)))
        script.add(fails(ApiError.Network))
        val vm = viewModel(scripted)
        vm.settled()

        vm.onBackground()
        idleFor(10 * 60 * 1_000)
        assertEquals("no probe in the background", 1, probes)

        script.clear()
        script.add(answersMe())
        vm.onForeground()
        runCurrent()
        assertEquals(2, probes)
        idleFor(PROBE_MS)
        assertEquals(SessionUiState.SignedIn(ME), next(vm, after = SessionUiState.SignedIn(null, ApiError.Network)))
    }

    @Test
    fun `TP-3_49 (h) Defined INTERNAL, then retry twice while the first retry runs 5 s - the second starts nothing`() = runTest {
        val internal = ApiError.Defined("INTERNAL", 500, null)
        store.save(storedSession(now.plusSeconds(3600)))
        script.add(fails(internal))
        script.add(fails(internal, after = 5_000))
        val vm = viewModel(scripted)

        assertEquals(SessionUiState.SignedIn(null, internal), vm.settled())
        vm.retry()
        runCurrent()
        assertEquals(2, probes)
        assertEquals("probing while the retry runs", true, vm.probing.value)
        idleFor(1_000)
        vm.retry()
        runCurrent()
        idleFor(4_500)

        assertEquals("two probes in total", 2, probes)
        assertEquals(false, vm.probing.value)
        assertEquals(SessionUiState.SignedIn(null, internal), vm.state.value)
    }

    @Test
    fun `TP-3_49x onSignedIn(me) is SignedIn(me) at once with no probe, and onSignedIn(null) probes once`() = runTest {
        server.start()
        val vm = viewModel(scripted)
        assertEquals(SessionUiState.SignedOut(SignedOutReason.None), vm.settled())
        script.add(answersMe())

        vm.onSignedIn(ME)
        assertEquals(SessionUiState.SignedIn(ME), vm.state.value)
        assertEquals(0, probes)

        vm.onSignedIn(null)
        runCurrent()
        idleFor(PROBE_MS)
        assertEquals(1, probes)
        assertEquals(SessionUiState.SignedIn(ME), next(vm, after = SessionUiState.Loading))
    }

    // ---- S-3 rows (A-68) ----

    @Test
    fun `TP-3_49 (k) me 401, then refresh 200 and me 200 - SignedIn(me), never SignedOut`() = runTest {
        val path = PathDispatcher()
        val fresh = wireTokens('N')
        path.answers[PATH_ME] = { request ->
            if (request.authorization == "Bearer ${fresh.accessToken}") jsonResponse(meJson()) else unauthenticated()
        }
        path.answers[PATH_REFRESH] = { jsonResponse(refreshJson(fresh)) }
        server.dispatcher = path
        server.start()
        store.save(storedSession(now.plusSeconds(3600)))

        val vm = viewModel(refreshingRepository())
        val states = statesOf(vm)

        assertEquals(SessionUiState.SignedIn(ME), vm.settled())
        runCurrent()
        assertEquals(1, path.of(PATH_REFRESH).size)
        assertEquals(fresh.accessToken, store.read()?.accessToken)
        assertEquals("never SignedOut: $states", true, states.none { it is SessionUiState.SignedOut })
    }

    @Test
    fun `TP-3_49 (l) me 401, then refresh REFRESH_INVALID - SignedOut(Ended) once, tokens cleared`() = runTest {
        val path = PathDispatcher()
        path.answers[PATH_ME] = { unauthenticated() }
        path.answers[PATH_REFRESH] = { definedError("REFRESH_INVALID", 401) }
        server.dispatcher = path
        server.start()
        store.save(storedSession(now.plusSeconds(3600)))

        val vm = viewModel(refreshingRepository())
        val states = statesOf(vm)

        assertEquals(SessionUiState.SignedOut(SignedOutReason.Ended), vm.settled())
        runCurrent()
        assertNull(store.read())
        assertEquals(SessionUiState.SignedOut(SignedOutReason.Ended), vm.state.value)
        assertEquals(
            "SignedOut(Ended) once: $states",
            1,
            states.count { it == SessionUiState.SignedOut(SignedOutReason.Ended) },
        )
    }

    @Test
    fun `TP-3_49 (l) SessionEvent Ended emitted while SignedIn - SignedOut(Ended)`() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(meJson()))
        server.start()
        store.save(storedSession(now.plusSeconds(3600)))
        val vm = viewModel(realRepository())
        assertEquals(SessionUiState.SignedIn(ME), vm.settled())
        runCurrent()

        sessionEvents.emit(SessionEvent.Ended)
        runCurrent()

        assertEquals(SessionUiState.SignedOut(SignedOutReason.Ended), vm.state.value)
    }

    @Test
    fun `TP-3_49x SessionEvent Ended while SignedIn(null) - SignedOut(Ended), and the backoff timer stops`() = runTest {
        store.save(storedSession(now.plusSeconds(3600)))
        script.add(fails(ApiError.Network))
        val vm = viewModel(scripted)
        assertEquals(SessionUiState.SignedIn(null, ApiError.Network), vm.settled())
        runCurrent()

        sessionEvents.emit(SessionEvent.Ended)
        runCurrent()
        idleFor(10 * 60 * 1_000)

        assertEquals(SessionUiState.SignedOut(SignedOutReason.Ended), vm.state.value)
        assertEquals("no probe after the session ended", 1, probes)
    }

    @Test
    fun `TP-3_49 (m) onSignedOut while SignedIn(me) - SignedOut(None)`() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(meJson()))
        server.start()
        store.save(storedSession(now.plusSeconds(3600)))
        val vm = viewModel(realRepository())
        assertEquals(SessionUiState.SignedIn(ME), vm.settled())

        vm.onSignedOut()
        runCurrent()

        assertEquals(SessionUiState.SignedOut(SignedOutReason.None), vm.state.value)
    }

    // ---- S-4: onMeUpdated (A-101) ----

    private val updated = ME.copy(twoStepEnabled = true, recoveryCodesLeft = 10, codesAcknowledged = false)

    @Test
    fun `TP-4_41 (f) onMeUpdated in SignedIn(null, Network) - SignedIn(me) with lastError null`() = runTest {
        store.save(storedSession(now.plusSeconds(3600)))
        script.add(fails(ApiError.Network))
        val vm = viewModel(scripted)
        assertEquals(SessionUiState.SignedIn(null, ApiError.Network), vm.settled())

        vm.onMeUpdated(updated)
        runCurrent()

        assertEquals(SessionUiState.SignedIn(updated, lastError = null), vm.state.value)
    }

    @Test
    fun `TP-4_41 (f) onMeUpdated in SignedOut - SignedOut unchanged`() = runTest {
        server.start()
        val vm = viewModel(realRepository())
        assertEquals(SessionUiState.SignedOut(SignedOutReason.None), vm.settled())

        vm.onMeUpdated(updated)
        runCurrent()

        assertEquals(SessionUiState.SignedOut(SignedOutReason.None), vm.state.value)
    }

    @Test
    fun `TP-4_41x onMeUpdated in SignedIn(me) - SignedIn(the new me)`() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(meJson()))
        server.start()
        store.save(storedSession(now.plusSeconds(3600)))
        val vm = viewModel(realRepository())
        assertEquals(SessionUiState.SignedIn(ME), vm.settled())

        vm.onMeUpdated(updated)
        runCurrent()

        assertEquals(SessionUiState.SignedIn(updated), vm.state.value)
    }

    @Test
    fun `TP-4_41x onMeUpdated in SignedIn(null, Network) - the backoff timer stops (no probe after)`() = runTest {
        store.save(storedSession(now.plusSeconds(3600)))
        script.add(fails(ApiError.Network))
        val vm = viewModel(scripted)
        assertEquals(SessionUiState.SignedIn(null, ApiError.Network), vm.settled())
        runCurrent()

        vm.onMeUpdated(updated)
        runCurrent()
        idleFor(10 * 60 * 1_000)

        assertEquals(SessionUiState.SignedIn(updated), vm.state.value)
        assertEquals("no probe once the state left SignedIn(null)", 1, probes)
    }
}
