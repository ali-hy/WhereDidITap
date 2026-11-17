// Shared test fixtures for identity's Android tests (test-architect): TP-1.34, TP-3.48, TP-3.49,
// TP-3.55, TP-3.57.
// - testTokenStore(): the real TokenStore over an in-memory AES key (A-7, A-8, A-37).
// - ME and meJson(): one Me and its wire JSON (MeSchema, S-1 fields).
// - eventually(): polls a condition (the repository runs on Dispatchers.IO, outside virtual time).
// - Wire JSON for S-3's auth answers (§5.2: SessionTokens, SignInResult, auth.refresh's output).
// - PathDispatcher: a MockWebServer dispatcher answering by path and recording each request.
package com.budmon.app.identity

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.budmon.app.identity.store.StoredSession
import com.budmon.app.identity.store.TokenCipher
import com.budmon.app.identity.store.TokenStore
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.fail
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import javax.crypto.KeyGenerator

fun testTokenStore(): TokenStore {
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val context: Context = ApplicationProvider.getApplicationContext()
    return TokenStore(context, TokenCipher { key })
}

val ME = Me(
    id = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a01",
    email = "mona@example.com",
    displayName = "Mona Hassan",
    locale = "en",
    timeZone = "Africa/Cairo",
    baseCurrency = "EGP",
    status = "active",
    isOwner = false,
)

/** `me`'s JSON as `me.get` answers it (MeSchema). */
fun meJson(me: Me = ME): String =
    """
    {"id":"${me.id}","email":"${me.email}","displayName":"${me.displayName}","locale":"${me.locale}",
     "timeZone":"${me.timeZone}","baseCurrency":"${me.baseCurrency}","status":"${me.status}",
     "deletionScheduledFor":null,"isOwner":${me.isOwner},"hasPassword":true,
     "passwordUpdatedAt":"2026-11-01T10:00:00.000Z","google":null,
     "twoStep":{"enabled":false,"recoveryCodesLeft":0,"codesAcknowledged":false},
     "confirmedUntil":null,"sessionId":"0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a02"}
    """.trimIndent()

/** A stored session expiring (refresh) at `refreshExpiresAt`. */
fun storedSession(refreshExpiresAt: Instant, userId: String = ME.id) = StoredSession(
    accessToken = "bma_" + "A".repeat(43),
    refreshToken = "bmr_" + "R".repeat(43),
    accessExpiresAt = refreshExpiresAt.minusSeconds(3600),
    refreshExpiresAt = refreshExpiresAt,
    userId = userId,
)

/** Calls `step` then checks `condition` until it holds, for up to `timeoutMs` of real time. */
fun eventually(what: String, timeoutMs: Long = 5_000, step: () -> Unit = {}, condition: () -> Boolean) {
    val deadline = System.nanoTime() + timeoutMs * 1_000_000
    while (System.nanoTime() < deadline) {
        step()
        if (condition()) return
        Thread.sleep(5)
    }
    fail("timed out waiting for $what")
}

// ---- S-3 wire JSON (§5.2) ----

const val PATH_SIGN_IN = "/api/v1/auth/sign-in"
const val PATH_SIGN_OUT = "/api/v1/auth/sign-out"
const val PATH_REFRESH = "/api/v1/auth/refresh"
const val PATH_ME = "/api/v1/me"

/** A JSON answer. */
fun jsonResponse(body: String, code: Int = 200): MockResponse =
    MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

/** A P-§5.1 error envelope, with `data` (a JSON object) when given. */
fun definedError(code: String, status: Int, data: String? = null): MockResponse {
    val dataPart = if (data == null) "" else ""","data":$data"""
    return jsonResponse("""{"defined":true,"code":"$code","status":$status,"message":"$code"$dataPart}""", status)
}

/** `401 UNAUTHENTICATED`, as the API answers a missing or expired access token. */
fun unauthenticated(): MockResponse = definedError("UNAUTHENTICATED", 401)

/** A gateway's 503 with no envelope (P-F-252: `Unavailable`). */
fun gateway503(): MockResponse = MockResponse().setResponseCode(503).setBody("Service Unavailable")

/** The session a 200 sign-in or refresh hands out (SessionTokens), and its stored form. */
data class WireTokens(
    val accessToken: String,
    val refreshToken: String,
    val accessExpiresAt: Instant,
    val refreshExpiresAt: Instant,
    val deviceToken: String?,
) {
    fun json(): String {
        val device = if (deviceToken == null) "null" else "\"$deviceToken\""
        return """{"accessToken":"$accessToken","refreshToken":"$refreshToken",""" +
            """"accessExpiresAt":"$accessExpiresAt","refreshExpiresAt":"$refreshExpiresAt","deviceToken":$device}"""
    }

    fun stored(userId: String) = StoredSession(accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, userId)
}

/** Tokens whose values start with [tag] (one letter), so each set is recognisable in a header. */
fun wireTokens(tag: Char, deviceToken: String? = "bmd_" + tag.toString().repeat(43)) = WireTokens(
    accessToken = "bma_" + tag.toString().repeat(43),
    refreshToken = "bmr_" + tag.toString().repeat(43),
    accessExpiresAt = Instant.parse("2026-11-15T10:15:00Z"),
    refreshExpiresAt = Instant.parse("2026-12-15T10:00:00Z"),
    deviceToken = deviceToken,
)

/** `auth.signIn`'s `signed_in` answer. */
fun signedInJson(tokens: WireTokens): String =
    """{"status":"signed_in","recoveryCodesLeft":null,"tokens":${tokens.json()}}"""

/** `auth.refresh`'s answer: `{ tokens, accessExpiresAt }`. */
fun refreshJson(tokens: WireTokens): String =
    """{"tokens":${tokens.json()},"accessExpiresAt":"${tokens.accessExpiresAt}"}"""

/** One request as the server saw it. */
data class SeenRequest(
    val path: String,
    val method: String,
    val authorization: String?,
    val client: String?,
    val body: String,
)

/**
 * Answers by path (404 for any other) and records every request. An answer gets the request,
 * so it can depend on its headers; tests replace entries before acting.
 */
class PathDispatcher : Dispatcher() {
    val seen = CopyOnWriteArrayList<SeenRequest>()
    val answers = ConcurrentHashMap<String, (SeenRequest) -> MockResponse>()

    override fun dispatch(request: RecordedRequest): MockResponse {
        val one = SeenRequest(
            path = request.path ?: "",
            method = request.method ?: "",
            authorization = request.getHeader("Authorization"),
            client = request.getHeader("X-Budmon-Client"),
            body = request.body.readUtf8(),
        )
        seen.add(one)
        return answers[one.path]?.invoke(one) ?: MockResponse().setResponseCode(404)
    }

    fun of(path: String): List<SeenRequest> = seen.filter { it.path == path }
}
