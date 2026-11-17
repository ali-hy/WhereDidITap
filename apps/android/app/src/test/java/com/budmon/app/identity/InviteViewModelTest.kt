// F-212 InviteViewModel over F-204 AuthRepository and MockWebServer (identity LLD §4.15, A-37,
// A-41, A-58). TP-1.34's ViewModel rows, TP-1.47's formError, TP-1.55's Android part, TP-3.48 (k)
// (A-77), plus TP-1.34x.
// S-3 setup (A-69, §8.2): InviteViewModel(repository, guard) with TP-3.48's guard (a MockK OutboxDao
// over `entries`, empty unless a test fills it, and a relaxed MockK OutboxRepository); the store is
// written only after guard.complete.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import com.budmon.app.R
import com.budmon.app.core.error.UiText
import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.core.outbox.OutboxRepository
import com.budmon.app.identity.store.TokenStore
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class InviteViewModelTest {
    private val server = MockWebServer()
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()
    private val authorizations = CopyOnWriteArrayList<Pair<String, String?>>()
    private val store: TokenStore = testTokenStore()
    private val token = "bmi_" + "Ab-_cdEFghIJklMNopQRstUVwxYZ0123456789-_abc"
    private val invitedEmail = "mona@example.com"
    private val deviceToken = "bmd_" + "D".repeat(43)

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code)
        .setHeader("Content-Type", "application/json").setBody(body)

    private fun previewJson(inviterName: String?): MockResponse {
        val inviter = if (inviterName == null) "null" else "\"$inviterName\""
        return json(
            """{"invitationId":"0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a03","email":"$invitedEmail",
               "inviterName":$inviter,"expiresAt":"2026-11-20T10:00:00.000Z","origin":"direct"}""",
        )
    }

    private fun acceptOk() = json(
        """{"status":"signed_in","recoveryCodesLeft":null,"tokens":{
           "accessToken":"bma_${"A".repeat(43)}","refreshToken":"bmr_${"R".repeat(43)}",
           "accessExpiresAt":"2026-11-15T10:15:00.000Z","refreshExpiresAt":"2026-12-15T10:00:00.000Z",
           "deviceToken":"$deviceToken"}}""",
    )

    /** A P-§5.1 error envelope, with `data` (a JSON object) when given. */
    private fun defined(code: String, status: Int, message: String, data: String? = null): MockResponse {
        val dataPart = if (data == null) "" else ""","data":$data"""
        return json("""{"defined":true,"code":"$code","status":$status,"message":"$message"$dataPart}""", status)
    }

    private fun unavailable() = MockResponse().setResponseCode(503).setBody("Service Unavailable")

    /** The answer per path; tests replace entries before acting. */
    private val answers = ConcurrentHashMap<String, () -> MockResponse>()

    @Before
    fun setUp() {
        runBlocking { store.resetAll() }
        answers["/api/v1/invitations/preview"] = { previewJson("Ahmed") }
        answers["/api/v1/auth/sign-up-options"] = {
            json("""{"currencies":[{"code":"EGP","minorUnits":2},{"code":"USD","minorUnits":2}],"locales":["en"]}""")
        }
        answers["/api/v1/invitations/accept"] = { acceptOk() }
        answers["/api/v1/me"] = { json(meJson()) }
        answers["/api/v1/auth/sign-out"] = { json("""{"ok":true}""") }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                requests.add(path to request.body.readUtf8())
                authorizations.add(path to request.getHeader("Authorization"))
                return answers[path]?.invoke() ?: MockResponse().setResponseCode(404)
            }
        }
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
        Dispatchers.resetMain()
    }

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

    private fun TestScope.viewModel(): InviteViewModel {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val repository = AuthRepository(OkHttpClient(), server.url("/"), store, mockk(relaxed = true))
        val guard = OutboxOwnerGuard(dao, store, outbox, repository)
        return InviteViewModel(repository, guard)
    }

    private val acceptedAccess = "bma_${"A".repeat(43)}"

    private fun TestScope.await(what: String, condition: () -> Boolean) =
        eventually(what, step = { testScheduler.advanceUntilIdle() }, condition = condition)

    private fun TestScope.toSetUp(vm: InviteViewModel) {
        vm.open(token)
        await("Join") { vm.state is InviteState.Join }
        vm.usePassword()
        await("SetUp") { vm.state is InviteState.SetUp }
    }

    private fun acceptBodies(): List<JsonObject> =
        requests.filter { it.first == "/api/v1/invitations/accept" }
            .map { Json.parseToJsonElement(it.second).jsonObject }

    @Test
    fun `TP-1_34 submit posts the accept with body delivery, the password and a device model, then stores the session`() = runTest {
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "Mona Hassan"
        vm.password = "violet staircase umbrella"
        var done: Me? = null
        var called = false

        vm.submit { me ->
            called = true
            done = me
        }
        await("onDone") { called }

        val body = acceptBodies().single()
        assertEquals("body", body.getValue("tokenDelivery").jsonPrimitive.content)
        val method = body.getValue("method").jsonObject
        assertEquals("password", method.getValue("kind").jsonPrimitive.content)
        assertEquals("violet staircase umbrella", method.getValue("password").jsonPrimitive.content)
        assertTrue(body.getValue("deviceModel").jsonPrimitive.content.isNotEmpty())
        assertEquals(token, body.getValue("token").jsonPrimitive.content)
        assertEquals("Mona Hassan", body.getValue("displayName").jsonPrimitive.content)
        assertEquals(ME, done)
        assertEquals(ME.id, store.read()?.userId)
        assertEquals(invitedEmail, store.lastEmail())
        assertEquals(deviceToken, store.deviceTokenFor(invitedEmail))
        assertEquals("the password is cleared after success", "", vm.password)
        assertEquals(ME.id, store.outboxOwnerUserId())
        verify(exactly = 1) { outbox.kick() }
    }

    @Test
    fun `TP-1_34 a 3-character password sets passwordError password_too_short and sends no request`() = runTest {
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "Mona Hassan"
        vm.password = "abc"
        var called = false

        vm.submit { called = true }
        testScheduler.advanceUntilIdle()

        assertEquals(R.string.password_too_short, vm.passwordError)
        assertTrue(acceptBodies().isEmpty())
        assertEquals(false, called)
    }

    @Test
    fun `TP-1_34x an empty name sets nameError and sends nothing, and backToJoin keeps the entered values`() = runTest {
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "   "
        vm.password = "violet staircase umbrella"

        vm.submit { }
        testScheduler.advanceUntilIdle()

        assertTrue(vm.nameError != null)
        assertNull(vm.passwordError)
        assertTrue(acceptBodies().isEmpty())
        vm.backToJoin()
        assertTrue(vm.state is InviteState.Join)
        assertEquals("violet staircase umbrella", vm.password)
    }

    // ---- Review B-7 (A-37, A-41, A-45), changed in S-3 (A-69) ----

    @Test
    fun `TP-3_48 (k) accept 200 then me 503 - Problem(Used(recent = true)) with the preview's inviter and origin, no onDone, a sign-out with the pending token, nothing stored`() =
        runTest {
            answers["/api/v1/me"] = { unavailable() }
            val vm = viewModel()
            toSetUp(vm)
            vm.name = "Mona Hassan"
            vm.password = "violet staircase umbrella"
            var called = false

            vm.submit { called = true }
            await("Problem") { vm.state is InviteState.Problem }

            // A-77: the preview's inviterName and origin; Used(recent = true) shows no ask line (screen rule).
            assertEquals(
                InviteState.Problem(InviteProblem.Used(recent = true), inviter = "Ahmed", origin = "direct"),
                vm.state,
            )
            assertEquals(false, called)
            await("the best-effort sign-out") { authorizations.any { it.first == "/api/v1/auth/sign-out" } }
            assertEquals(
                "Bearer $acceptedAccess",
                authorizations.single { it.first == "/api/v1/auth/sign-out" }.second,
            )
            assertNull(store.read())
            assertNull(store.deviceTokenFor(invitedEmail))
            assertNull(store.lastEmail())
            verify(exactly = 0) { outbox.kick() }
        }

    // ---- S-3: the outbox owner check after an accept (A-69, §8.2) ----

    /** Set-up filled in, with 3 entries owned by another user; submit asks about them. */
    private fun TestScope.askingAboutOtherEntries(onDone: (Me) -> Unit): InviteViewModel {
        entries = 3
        runBlocking { store.setOutboxOwnerUserId("0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a99") }
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "Mona Hassan"
        vm.password = "violet staircase umbrella"
        vm.submit(onDone)
        await("ownerDialog") { vm.ownerDialog != null }
        return vm
    }

    @Test
    fun `TP-1_34x another user's 3 entries - ownerDialog 3, no onDone, nothing stored`() = runTest {
        var called = false

        val vm = askingAboutOtherEntries { called = true }

        assertEquals(3, vm.ownerDialog)
        assertEquals(false, called)
        assertNull(store.read())
        verify(exactly = 0) { outbox.kick() }
    }

    @Test
    fun `TP-1_34x discardOtherUsersEntries - entries deleted, owner and session stored, onDone(me)`() = runTest {
        val vm = askingAboutOtherEntries { }
        var done: Me? = null

        vm.discardOtherUsersEntries { me -> done = me }
        await("onDone") { done != null }

        assertEquals(ME, done)
        coVerify(exactly = 1) { dao.deleteAll() }
        assertEquals(ME.id, store.outboxOwnerUserId())
        assertEquals(ME.id, store.read()?.userId)
        verify(exactly = 1) { outbox.kick() }
    }

    @Test
    fun `TP-1_34x keepOtherUsersEntries - Problem(Used(recent = true)), a sign-out with the pending token, entries and owner kept`() =
        runTest {
            val vm = askingAboutOtherEntries { }

            vm.keepOtherUsersEntries()
            await("Problem") { vm.state is InviteState.Problem }
            await("the sign-out") { authorizations.any { it.first == "/api/v1/auth/sign-out" } }

            assertEquals(InviteProblem.Used(recent = true), (vm.state as InviteState.Problem).problem)
            assertEquals(
                "Bearer $acceptedAccess",
                authorizations.single { it.first == "/api/v1/auth/sign-out" }.second,
            )
            coVerify(exactly = 0) { dao.deleteAll() }
            assertEquals("0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a99", store.outboxOwnerUserId())
            assertNull(store.read())
        }

    private fun problemCases(): List<Pair<() -> MockResponse, (InviteProblem) -> Boolean>> = listOf(
        { defined("INVITATION_EXPIRED", 410, "Invitation expired", """{"expiredAt":"2026-11-14T10:00:00.000Z"}""") } to
            { p -> p == InviteProblem.Expired(Instant.parse("2026-11-14T10:00:00Z")) },
        { defined("INVITATION_REVOKED", 410, "Invitation revoked") } to { p -> p == InviteProblem.Revoked },
        { defined("INVITATION_USED", 409, "Invitation already used", """{"recent":true}""") } to
            { p -> p == InviteProblem.Used(true) },
        { defined("INVITATION_USED", 409, "Invitation already used", """{"recent":false}""") } to
            { p -> p == InviteProblem.Used(false) },
        { defined("INVITATION_INVALID", 400, "Invitation invalid") } to { p -> p == InviteProblem.Invalid },
        { unavailable() } to { p -> p is InviteProblem.Failed },
    )

    @Test
    fun `TP-1_34x a preview's problems map to Expired(at), Revoked, Used(true), Used(false), Invalid and Failed`() = runTest {
        for ((index, case) in problemCases().withIndex()) {
            val (answer, expected) = case
            answers["/api/v1/invitations/preview"] = answer
            val vm = viewModel()

            vm.open(token)
            await("a problem (case $index)") { vm.state is InviteState.Problem }

            val problem = (vm.state as InviteState.Problem).problem
            assertTrue("case $index: $problem", expected(problem))
        }
    }

    @Test
    fun `TP-1_34x an accept's invitation problems map the same way`() = runTest {
        for ((index, case) in problemCases().dropLast(1).withIndex()) {
            val (answer, expected) = case
            answers["/api/v1/invitations/accept"] = answer
            val vm = viewModel()
            toSetUp(vm)
            vm.name = "Mona Hassan"
            vm.password = "violet staircase umbrella"

            vm.submit { }
            await("a problem (case $index)") { vm.state is InviteState.Problem }

            val problem = (vm.state as InviteState.Problem).problem
            assertTrue("case $index: $problem", expected(problem))
        }
    }

    @Test
    fun `TP-1_34x an accept answering 503 sets formError (F-212 - not an invitation key) and stays on SetUp`() = runTest {
        answers["/api/v1/invitations/accept"] = { unavailable() }
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "Mona Hassan"
        vm.password = "violet staircase umbrella"

        vm.submit { }
        await("formError") { vm.formError != null }

        assertTrue(vm.state is InviteState.SetUp)
    }

    @Test
    fun `TP-1_34x PASSWORD_TOO_WEAK common - passwordError password_common`() = runTest {
        answers["/api/v1/invitations/accept"] = {
            defined("PASSWORD_TOO_WEAK", 400, "Password too weak", """{"reason":"common"}""")
        }
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "Mona Hassan"
        vm.password = "password1234"

        vm.submit { }
        await("passwordError") { vm.passwordError != null }

        assertEquals(R.string.password_common, vm.passwordError)
        assertTrue(vm.state is InviteState.SetUp)
    }

    @Test
    fun `TP-1_34x VALIDATION_FAILED on displayName, baseCurrency and timeZone - the matching field errors`() = runTest {
        answers["/api/v1/invitations/accept"] = {
            defined(
                "VALIDATION_FAILED",
                400,
                "Validation failed",
                """{"issues":[{"path":["displayName"],"code":"too_big","message":"Too big"},
                   {"path":["baseCurrency"],"code":"unknown_currency","message":"Unknown currency"},
                   {"path":["timeZone"],"code":"invalid_time_zone","message":"Invalid time zone"}]}""",
            )
        }
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "Mona Hassan"
        vm.password = "violet staircase umbrella"

        vm.submit { }
        await("field errors") { vm.nameError != null && vm.currencyError != null && vm.timeZoneError != null }

        assertNull(vm.passwordError)
        assertTrue(vm.state is InviteState.SetUp)
    }

    @Test
    fun `TP-1_34x USER_CAP_REACHED - formError invite_full with an inviter`() = runTest {
        answers["/api/v1/invitations/accept"] = { defined("USER_CAP_REACHED", 409, "User cap reached") }
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "Mona Hassan"
        vm.password = "violet staircase umbrella"

        vm.submit { }
        await("formError") { vm.formError != null }

        assertEquals(R.string.invite_full, vm.formError?.resId)
    }

    @Test
    fun `TP-1_47 USER_CAP_REACHED with no inviter - formError is UiText(invite_full_no_inviter)`() = runTest {
        answers["/api/v1/invitations/preview"] = { previewJson(null) }
        answers["/api/v1/invitations/accept"] = { defined("USER_CAP_REACHED", 409, "User cap reached") }
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "Mona Hassan"
        vm.password = "violet staircase umbrella"

        vm.submit { }
        await("formError") { vm.formError != null }

        assertEquals(UiText(R.string.invite_full_no_inviter), vm.formError)
    }

    @Test
    fun `TP-1_34x open() with the same token does nothing (values kept) unless the state is a Problem, which checks again`() = runTest {
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "Mona Hassan"
        val previews = { requests.count { it.first == "/api/v1/invitations/preview" } }

        vm.open(token)
        testScheduler.advanceUntilIdle()

        assertTrue(vm.state is InviteState.SetUp)
        assertEquals("Mona Hassan", vm.name)
        assertEquals(1, previews())

        val other = viewModel()
        answers["/api/v1/invitations/preview"] = { defined("INVITATION_REVOKED", 410, "Invitation revoked") }
        other.open(token)
        await("Problem") { other.state is InviteState.Problem }
        answers["/api/v1/invitations/preview"] = { previewJson("Ahmed") }

        other.open(token)
        await("Join after the re-check") { other.state is InviteState.Join }
        assertEquals(3, previews())
    }

    @Test
    fun `TP-1_55 a preview INVITATION_EXPIRED with inviterName Mona - Problem(Expired(at), inviter Mona, origin direct)`() = runTest {
        answers["/api/v1/invitations/preview"] = {
            defined(
                "INVITATION_EXPIRED",
                410,
                "Invitation expired",
                """{"expiredAt":"2026-11-01T10:00:00.000Z","inviterName":"Mona","origin":"direct"}""",
            )
        }
        val vm = viewModel()

        vm.open(token)
        await("Problem") { vm.state is InviteState.Problem }

        val at = Instant.parse("2026-11-01T10:00:00Z")
        val expected = InviteState.Problem(InviteProblem.Expired(at), inviter = "Mona", origin = "direct")
        assertEquals(expected, vm.state)
    }

    @Test
    fun `TP-1_55x an accept answered INVITATION_REVOKED with inviterName Mona - the error's inviter, not the preview's`() = runTest {
        answers["/api/v1/invitations/accept"] = {
            defined("INVITATION_REVOKED", 410, "Invitation revoked", """{"inviterName":"Mona","origin":"direct"}""")
        }
        val vm = viewModel()
        toSetUp(vm)
        vm.name = "Mona Hassan"
        vm.password = "violet staircase umbrella"

        vm.submit { }
        await("Problem") { vm.state is InviteState.Problem }

        assertEquals(InviteState.Problem(InviteProblem.Revoked, inviter = "Mona", origin = "direct"), vm.state)
    }
}
