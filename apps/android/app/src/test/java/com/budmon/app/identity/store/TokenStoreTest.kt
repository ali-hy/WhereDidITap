// F-201 TokenStore (identity LLD §4.15, A-8). TP-0.29 (b) to (d), plus extra cases TP-0.29x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Shapes per A-8: TokenStore(context, cipher); StoredSession(accessToken, refreshToken,
// accessExpiresAt: Instant, refreshExpiresAt: Instant, userId); read/save/clear/resetAll;
// deviceTokenFor/saveDeviceToken; lastEmail/saveLastEmail; usedGoogleBefore/setUsedGoogleBefore;
// outboxOwnerUserId/setOutboxOwnerUserId. A decrypting accessor that meets an unreadable value
// resets the store and returns null. The DataStore is process-wide, so every store here shares it
// and each test starts from resetAll().
package com.budmon.app.identity.store

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

@RunWith(RobolectricTestRunner::class)
class TokenStoreTest {
    private fun aesKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val k1 = aesKey()
    private val k2 = aesKey()
    private val store = TokenStore(context, TokenCipher { k1 })
    private val otherKeyStore = TokenStore(context, TokenCipher { k2 })

    private val session = StoredSession(
        accessToken = "bma_" + "A".repeat(43),
        refreshToken = "bmr_" + "R".repeat(43),
        accessExpiresAt = Instant.parse("2026-11-02T10:15:00Z"),
        refreshExpiresAt = Instant.parse("2026-12-02T10:00:00Z"),
        userId = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a80",
    )
    private val device = "bmd_" + "D".repeat(43)

    @Before
    fun setUp() = runTest {
        store.resetAll()
    }

    @Test
    fun `TP-0_29x a saved session reads back equal`() = runTest {
        store.save(session)

        assertEquals(session, store.read())
    }

    @Test
    fun `TP-0_29x read with nothing stored is null`() = runTest {
        assertNull(store.read())
    }

    @Test
    fun `TP-0_29 (b) values a K2 store cannot decrypt - read() is null without throwing, then everything is reset`() = runTest {
        store.save(session)
        store.saveLastEmail("ali@example.com")
        store.saveDeviceToken("ali@example.com", device)
        store.setOutboxOwnerUserId(session.userId)

        val read = otherKeyStore.read()

        assertNull(read)
        assertNull(store.deviceTokenFor("ali@example.com"))
        assertNull(store.lastEmail())
        assertNull(store.outboxOwnerUserId())
        assertNull(store.read())
    }

    @Test
    fun `TP-0_29x lastEmail through a K2 store also resets the store (A-8 every decrypting accessor)`() = runTest {
        store.save(session)
        store.saveLastEmail("ali@example.com")
        store.setUsedGoogleBefore(true)

        assertNull(otherKeyStore.lastEmail())

        assertNull(store.read())
        assertFalse(store.usedGoogleBefore())
    }

    @Test
    fun `TP-0_29 (c) clear() removes the session and keeps the device token, lastEmail, usedGoogleBefore and the outbox owner`() =
        runTest {
            store.save(session)
            store.saveDeviceToken("ali@example.com", device)
            store.saveLastEmail("ali@example.com")
            store.setUsedGoogleBefore(true)
            store.setOutboxOwnerUserId(session.userId)

            store.clear()

            assertNull(store.read())
            assertEquals(device, store.deviceTokenFor("ali@example.com"))
            assertEquals("ali@example.com", store.lastEmail())
            assertTrue(store.usedGoogleBefore())
            assertEquals(session.userId, store.outboxOwnerUserId())
        }

    @Test
    fun `TP-0_29 (d) deviceTokenFor normalises the email, and another email gets null`() = runTest {
        store.saveDeviceToken("ali@example.com", device)

        assertEquals(device, store.deviceTokenFor(" Ali@Example.COM "))
        assertNull(store.deviceTokenFor("mona@example.com"))
    }

    @Test
    fun `TP-0_29 (d) saving a device token for a second email replaces the first`() = runTest {
        val second = "bmd_" + "E".repeat(43)
        store.saveDeviceToken("ali@example.com", device)

        store.saveDeviceToken("mona@example.com", second)

        assertEquals(second, store.deviceTokenFor("mona@example.com"))
        assertNull(store.deviceTokenFor("ali@example.com"))
    }

    @Test
    fun `TP-0_29x usedGoogleBefore defaults to false, and setOutboxOwnerUserId(null) removes the owner`() = runTest {
        assertFalse(store.usedGoogleBefore())
        store.setOutboxOwnerUserId(session.userId)

        store.setOutboxOwnerUserId(null)

        assertNull(store.outboxOwnerUserId())
    }

    @Test
    fun `TP-0_29x resetAll() removes everything`() = runTest {
        store.save(session)
        store.saveDeviceToken("ali@example.com", device)
        store.saveLastEmail("ali@example.com")
        store.setUsedGoogleBefore(true)
        store.setOutboxOwnerUserId(session.userId)

        store.resetAll()

        assertNull(store.read())
        assertNull(store.deviceTokenFor("ali@example.com"))
        assertNull(store.lastEmail())
        assertFalse(store.usedGoogleBefore())
        assertNull(store.outboxOwnerUserId())
    }
}
