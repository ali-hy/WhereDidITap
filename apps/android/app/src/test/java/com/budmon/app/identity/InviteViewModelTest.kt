// F-212 InviteViewModel over F-204 AuthRepository and MockWebServer (identity LLD §4.15, A-37,
// A-41). TP-1.34's ViewModel rows, plus TP-1.34x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import com.budmon.app.R
import com.budmon.app.identity.store.TokenStore
import io.mockk.mockk
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
import java.util.concurrent.CopyOnWriteArrayList

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class InviteViewModelTest {
    private val server = MockWebServer()
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()
    private val store: TokenStore = testTokenStore()
    private val token = "bmi_" + "Ab-_cdEFghIJklMNopQRstUVwxYZ0123456789-_abc"
    private val invitedEmail = "mona@example.com"
    private val deviceToken = "bmd_" + "D".repeat(43)

    private fun json(body: String) = MockResponse().setResponseCode(200)
        .setHeader("Content-Type", "application/json").setBody(body)

    @Before
    fun setUp() {
        runBlocking { store.resetAll() }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                requests.add(path to request.body.readUtf8())
                return when (path) {
                    "/api/v1/invitations/preview" -> json(
                        """{"invitationId":"0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a03","email":"$invitedEmail",
                           "inviterName":"Ahmed","expiresAt":"2026-11-20T10:00:00.000Z","origin":"direct"}""",
                    )
                    "/api/v1/auth/sign-up-options" -> json(
                        """{"currencies":[{"code":"EGP","minorUnits":2},{"code":"USD","minorUnits":2}],"locales":["en"]}""",
                    )
                    "/api/v1/invitations/accept" -> json(
                        """{"status":"signed_in","recoveryCodesLeft":null,"tokens":{
                           "accessToken":"bma_${"A".repeat(43)}","refreshToken":"bmr_${"R".repeat(43)}",
                           "accessExpiresAt":"2026-11-15T10:15:00.000Z","refreshExpiresAt":"2026-12-15T10:00:00.000Z",
                           "deviceToken":"$deviceToken"}}""",
                    )
                    "/api/v1/me" -> json(meJson())
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
        Dispatchers.resetMain()
    }

    private fun TestScope.viewModel(): InviteViewModel {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val repository = AuthRepository(OkHttpClient(), server.url("/"), store, mockk(relaxed = true))
        return InviteViewModel(repository)
    }

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
}
