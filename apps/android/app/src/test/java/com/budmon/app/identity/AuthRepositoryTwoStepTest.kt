// F-204's S-4 wrappers (identity LLD §5.2, §7, §8.2's S-4 signatures, A-69, A-99). TP-4.38's Android
// half, plus TP-4.38x.
// Setup per TP-4.38: Robolectric; MockWebServer; the real AuthRepository and TokenStore (in-memory
// key, resetAll() first), with F-202 on the client as AppModule's. Each test pins the method, path
// and body of one wrapper's request; one factor only, `{}` for procedures without input.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import android.os.Build
import com.budmon.app.core.network.ApiError
import com.budmon.app.identity.net.AuthInterceptor
import com.budmon.app.identity.store.TokenStore
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant

private const val CODE = "123456"
private const val RECOVERY = "7KQ2M3XD4TRA"
private const val CHALLENGE_TOKEN = "bmc_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"

@RunWith(RobolectricTestRunner::class)
class AuthRepositoryTwoStepTest {
    private val server = MockWebServer()
    private val http = PathDispatcher()
    private val store: TokenStore = testTokenStore()
    private lateinit var baseUrl: HttpUrl
    private lateinit var repository: AuthRepository

    private val tokensX = wireTokens('X')

    /** The session stored before the authed calls (`me.*`). */
    private val stored = storedSession(Instant.parse("2026-12-15T10:00:00Z"))

    private val challenge = TwoStepChallenge(
        token = CHALLENGE_TOKEN,
        expiresAt = Instant.parse("2026-11-15T10:05:00Z"),
        email = ME.email,
        password = "violet staircase umbrella",
    )

    private val otpauth = "otpauth://totp/x:mona%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
    private val secretJson =
        """{"secret":"JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP","otpauthUri":"$otpauth","expiresAt":"2026-11-15T10:10:00.000Z"}"""
    private val secret = TwoStepSecret(
        secret = "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP",
        otpauthUri = otpauth,
        expiresAt = Instant.parse("2026-11-15T10:10:00Z"),
    )
    private val codes = "ABCDEFGHJK".map { "7KQ2-M3XD-4TR$it" }
    private val codesJson = """{"recoveryCodes":[${codes.joinToString(",") { "\"$it\"" }}]}"""

    @Before
    fun setUp() {
        runBlocking { store.resetAll() }
        http.answers[PATH_VERIFY_TWO_STEP] = { jsonResponse(verifiedJson(tokensX)) }
        http.answers[PATH_ME] = { request ->
            if (request.authorization == "Bearer ${tokensX.accessToken}") jsonResponse(meJson(ME)) else unauthenticated()
        }
        http.answers[PATH_SIGN_OUT] = { jsonResponse("""{"ok":true}""") }
        http.answers[PATH_CONFIRM] = { jsonResponse("""{"confirmedUntil":"2026-11-15T10:20:00.000Z"}""") }
        http.answers[PATH_TWO_STEP_SETUP] = { jsonResponse(secretJson) }
        http.answers[PATH_TWO_STEP_ENABLE] = { jsonResponse(codesJson) }
        http.answers[PATH_ACK_CODES] = { jsonResponse("""{"ok":true}""") }
        http.answers[PATH_TWO_STEP_DISABLE] = { jsonResponse("""{"ok":true}""") }
        http.answers[PATH_RECOVERY_CODES] = { jsonResponse(codesJson) }
        http.answers[PATH_REPLACE_START] = { jsonResponse(secretJson) }
        http.answers[PATH_REPLACE_CONFIRM] = { jsonResponse("""{"ok":true}""") }
        server.dispatcher = http
        server.start()
        baseUrl = server.url("/")
        val client = OkHttpClient.Builder().addInterceptor(AuthInterceptor(store, baseUrl)).build()
        repository = AuthRepository(client, baseUrl, store, mockk(relaxed = true))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun body(request: SeenRequest): JsonObject = Json.parseToJsonElement(request.body).jsonObject

    /** The one request to [path]: POST, with the stored session's token, and its body. */
    private fun authedPost(path: String): JsonObject {
        val request = http.of(path).single()
        assertEquals("POST", request.method)
        assertEquals("Bearer ${stored.accessToken}", request.authorization)
        return body(request)
    }

    private val empty = JsonObject(emptyMap())

    private fun signedIn() = runBlocking { store.save(stored) }

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

    // ---- auth.verifyTwoStep ----

    @Test
    fun `TP-4_38 verifyTwoStep(challenge, 123456, null) - challengeToken, code only, body delivery, model, the stored deviceToken`() =
        runBlocking {
            val device = "bmd_" + "K".repeat(43)
            store.saveDeviceToken(ME.email, device)

            repository.verifyTwoStep(challenge, CODE, null)

            val request = http.of(PATH_VERIFY_TWO_STEP).single()
            assertEquals("POST", request.method)
            val expected = buildJsonObject {
                put("challengeToken", CHALLENGE_TOKEN)
                put("code", CODE)
                put("tokenDelivery", "body")
                put("deviceModel", Build.MODEL.take(100))
                put("deviceToken", device)
            }
            assertEquals(expected, body(request))
        }

    @Test
    fun `TP-4_38 verifyTwoStep - me read with the new token, a PendingSignIn returned, nothing stored before F-205`() = runBlocking {
        val verified = repository.verifyTwoStep(challenge, CODE, null)

        assertEquals("Bearer ${tokensX.accessToken}", http.of(PATH_ME).single().authorization)
        assertEquals(TwoStepVerified(PendingSignIn(tokensX.stored(userId = ME.id), tokensX.deviceToken, ME), null), verified)
        assertNull(store.read())
        assertNull(store.deviceTokenFor(ME.email))
        assertNull(store.lastEmail())
    }

    @Test
    fun `TP-4_38x verifyTwoStep with no stored deviceToken for the challenge email - deviceToken omitted`() = runBlocking {
        store.saveDeviceToken("someone.else@example.com", "bmd_" + "Z".repeat(43))

        repository.verifyTwoStep(challenge, CODE, null)

        val sent = body(http.of(PATH_VERIFY_TWO_STEP).single())
        assertTrue("no deviceToken key", !sent.containsKey("deviceToken"))
        assertEquals(setOf("challengeToken", "code", "tokenDelivery", "deviceModel"), sent.keys)
    }

    @Test
    fun `TP-4_38x verifyTwoStep(challenge, null, recovery) - recoveryCode only, recoveryCodesLeft returned`() = runBlocking {
        http.answers[PATH_VERIFY_TWO_STEP] = { jsonResponse(verifiedJson(tokensX, recoveryCodesLeft = 7)) }

        val verified = repository.verifyTwoStep(challenge, null, RECOVERY)

        val expected = buildJsonObject {
            put("challengeToken", CHALLENGE_TOKEN)
            put("recoveryCode", RECOVERY)
            put("tokenDelivery", "body")
            put("deviceModel", Build.MODEL.take(100))
        }
        assertEquals(expected, body(http.of(PATH_VERIFY_TWO_STEP).single()))
        assertEquals(7, verified.recoveryCodesLeft)
    }

    @Test
    fun `TP-4_38x verifyTwoStep, me answering 503 - ApiException(Unavailable), a sign-out with the new token, nothing stored (as signIn, A-69)`() =
        runBlocking {
            http.answers[PATH_ME] = { gateway503() }

            val error = apiErrorOf { repository.verifyTwoStep(challenge, CODE, null) }

            assertEquals(ApiError.Unavailable, error)
            assertEquals("Bearer ${tokensX.accessToken}", http.of(PATH_SIGN_OUT).single().authorization)
            assertNull(store.read())
        }

    @Test
    fun `TP-4_38x verifyTwoStep TWO_STEP_CHALLENGE_EXPIRED - that ApiException with its data, no me request`() = runBlocking {
        http.answers[PATH_VERIFY_TWO_STEP] = {
            definedError("TWO_STEP_CHALLENGE_EXPIRED", 401, """{"reason":"too_many_attempts"}""")
        }

        val error = apiErrorOf { repository.verifyTwoStep(challenge, CODE, null) }

        val expectedData = buildJsonObject { put("reason", "too_many_attempts") }
        assertEquals(ApiError.Defined("TWO_STEP_CHALLENGE_EXPIRED", 401, expectedData), error)
        assertTrue(http.of(PATH_ME).isEmpty())
    }

    // ---- me.* ----

    @Test
    fun `TP-4_38 confirm(code = 123456) - POST me-confirm with the code only, confirmedUntil returned`() = runBlocking {
        signedIn()

        val until = repository.confirm(code = CODE)

        assertEquals(buildJsonObject { put("code", CODE) }, authedPost(PATH_CONFIRM))
        assertEquals(Instant.parse("2026-11-15T10:20:00Z"), until)
    }

    @Test
    fun `TP-4_38x confirm(password) - the password only`() = runBlocking {
        signedIn()

        repository.confirm(password = "violet staircase umbrella")

        assertEquals(buildJsonObject { put("password", "violet staircase umbrella") }, authedPost(PATH_CONFIRM))
    }

    @Test
    fun `TP-4_38 twoStepSetup() - POST me-two-step-setup with an empty object, the secret returned`() = runBlocking {
        signedIn()

        val result = repository.twoStepSetup()

        assertEquals(empty, authedPost(PATH_TWO_STEP_SETUP))
        assertEquals(secret, result)
    }

    @Test
    fun `TP-4_38 twoStepEnable(123456) - POST me-two-step-enable with the code, the 10 codes returned`() = runBlocking {
        signedIn()

        val result = repository.twoStepEnable(CODE)

        assertEquals(buildJsonObject { put("code", CODE) }, authedPost(PATH_TWO_STEP_ENABLE))
        assertEquals(codes, result)
    }

    @Test
    fun `TP-4_38 acknowledgeRecoveryCodes() - POST me-two-step-acknowledge-codes with an empty object`() = runBlocking {
        signedIn()

        repository.acknowledgeRecoveryCodes()

        assertEquals(empty, authedPost(PATH_ACK_CODES))
    }

    @Test
    fun `TP-4_38 twoStepDisable(null, recovery) - POST me-two-step-disable with the recovery code only`() = runBlocking {
        signedIn()

        repository.twoStepDisable(null, RECOVERY)

        assertEquals(buildJsonObject { put("recoveryCode", RECOVERY) }, authedPost(PATH_TWO_STEP_DISABLE))
    }

    @Test
    fun `TP-4_38x twoStepDisable(123456, null) - the code only`() = runBlocking {
        signedIn()

        repository.twoStepDisable(CODE, null)

        assertEquals(buildJsonObject { put("code", CODE) }, authedPost(PATH_TWO_STEP_DISABLE))
    }

    @Test
    fun `TP-4_38 regenerateRecoveryCodes() - POST me-two-step-recovery-codes with an empty object, the codes returned`() = runBlocking {
        signedIn()

        val result = repository.regenerateRecoveryCodes()

        assertEquals(empty, authedPost(PATH_RECOVERY_CODES))
        assertEquals(codes, result)
    }

    @Test
    fun `TP-4_38 twoStepReplaceStart() - POST me-two-step-replace-start with an empty object, the secret returned`() = runBlocking {
        signedIn()

        val result = repository.twoStepReplaceStart()

        assertEquals(empty, authedPost(PATH_REPLACE_START))
        assertEquals(secret, result)
    }

    @Test
    fun `TP-4_38 twoStepReplaceConfirm(123456) - POST me-two-step-replace-confirm with the code`() = runBlocking {
        signedIn()

        repository.twoStepReplaceConfirm(CODE)

        assertEquals(buildJsonObject { put("code", CODE) }, authedPost(PATH_REPLACE_CONFIRM))
    }

    @Test
    fun `TP-4_38x confirm answered TWO_STEP_CODE_INVALID - that ApiException`() = runBlocking {
        signedIn()
        http.answers[PATH_CONFIRM] = { definedError("TWO_STEP_CODE_INVALID", 400) }

        val error = apiErrorOf { repository.confirm(code = CODE) }

        assertEquals("TWO_STEP_CODE_INVALID", (error as ApiError.Defined).key)
    }

    // ---- Me's S-4 fields (F-204, A-99) ----

    @Test
    fun `TP-4_38x getMe - twoStepEnabled, recoveryCodesLeft and codesAcknowledged read from me-get's twoStep`() = runBlocking {
        val withTwoStep = ME.copy(twoStepEnabled = true, recoveryCodesLeft = 4, codesAcknowledged = false)
        http.answers[PATH_ME] = { jsonResponse(meJson(withTwoStep)) }
        signedIn()

        val me = repository.getMe()

        assertEquals(true, me.twoStepEnabled)
        assertEquals(4, me.recoveryCodesLeft)
        assertEquals(false, me.codesAcknowledged)
        assertEquals(withTwoStep, me)
    }

    @Test
    fun `TP-4_38x Me's S-4 fields default to off, 0 codes left, acknowledged`() {
        assertEquals(false, ME.twoStepEnabled)
        assertEquals(0, ME.recoveryCodesLeft)
        assertEquals(true, ME.codesAcknowledged)
    }
}
