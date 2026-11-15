// Shared test fixtures for identity's Android tests (test-architect): TP-1.34, TP-3.49.
// - testTokenStore(): the real TokenStore over an in-memory AES key (A-7, A-8, A-37).
// - ME and meJson(): one Me and its wire JSON (MeSchema, S-1 fields).
// - eventually(): polls a condition (the repository runs on Dispatchers.IO, outside virtual time).
package com.budmon.app.identity

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.budmon.app.identity.store.StoredSession
import com.budmon.app.identity.store.TokenCipher
import com.budmon.app.identity.store.TokenStore
import org.junit.Assert.fail
import java.time.Instant
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
