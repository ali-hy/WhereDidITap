// F-200 TokenCipher (identity LLD §4.15, A-7, A-18). TP-0.29 (a) and (f), plus extra cases TP-0.29x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Shapes per A-7: TokenCipher's internal constructor takes the key provider `() -> SecretKey`
// (called per operation, so Robolectric never touches the Android Keystore); encrypt's output is
// IV(12) ‖ ciphertext ‖ 128-bit tag; TokenCipherException(cause) is in the same package.
package com.budmon.app.identity.store

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.IOException
import java.security.ProviderException
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

@RunWith(RobolectricTestRunner::class)
class TokenCipherTest {
    private fun aesKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private val k1 = aesKey()
    private val k2 = aesKey()
    private val plain = ("bma_" + "A".repeat(43)).toByteArray()

    @Test
    fun `TP-0_29 (a) encrypt then decrypt gives the same bytes`() {
        val cipher = TokenCipher { k1 }

        val sealed = cipher.encrypt(plain)

        assertArrayEquals(plain, cipher.decrypt(sealed))
    }

    @Test
    fun `TP-0_29x the output is IV(12) then ciphertext then a 16-byte tag, without the plain text`() {
        val sealed = TokenCipher { k1 }.encrypt(plain)

        assertEquals(12 + plain.size + 16, sealed.size)
        assertFalse(String(sealed, Charsets.ISO_8859_1).contains("bma_"))
    }

    @Test
    fun `TP-0_29x two encryptions of the same value differ (a fresh IV each time)`() {
        val cipher = TokenCipher { k1 }

        assertFalse(cipher.encrypt(plain).contentEquals(cipher.encrypt(plain)))
    }

    @Test
    fun `TP-0_29 (a) a ciphertext with one byte flipped throws TokenCipherException`() {
        val cipher = TokenCipher { k1 }
        val sealed = cipher.encrypt(plain)
        val middle = sealed.size / 2
        sealed[middle] = (sealed[middle].toInt() xor 0x01).toByte()

        assertThrows(TokenCipherException::class.java) { cipher.decrypt(sealed) }
    }

    @Test
    fun `TP-0_29 (a) a K1 ciphertext decrypted under K2 throws TokenCipherException`() {
        val sealed = TokenCipher { k1 }.encrypt(plain)

        assertThrows(TokenCipherException::class.java) { TokenCipher { k2 }.decrypt(sealed) }
    }

    @Test
    fun `TP-0_29 (a) decrypting 10 bytes throws TokenCipherException`() {
        assertThrows(TokenCipherException::class.java) { TokenCipher { k1 }.decrypt(ByteArray(10)) }
    }

    // --- TP-0.29 (f) (A-18): a key provider that fails as a broken Keystore does

    private fun failingProviders(): List<Throwable> =
        listOf(IOException("keystore load failed"), ProviderException("keystore provider failed"))

    @Test
    fun `TP-0_29 (f) encrypt wraps the provider's IOException and ProviderException, cause preserved`() {
        for (failure in failingProviders()) {
            val cipher = TokenCipher { throw failure }

            val thrown = assertThrows(TokenCipherException::class.java) { cipher.encrypt(plain) }

            assertSame(failure.toString(), failure, thrown.cause)
        }
    }

    @Test
    fun `TP-0_29 (f) decrypt wraps the provider's IOException and ProviderException, cause preserved`() {
        val sealed = TokenCipher { k1 }.encrypt(plain)
        for (failure in failingProviders()) {
            val cipher = TokenCipher { throw failure }

            val thrown = assertThrows(TokenCipherException::class.java) { cipher.decrypt(sealed) }

            assertSame(failure.toString(), failure, thrown.cause)
        }
    }

    @Test
    fun `TP-0_29x (A-18) any other exception from the provider propagates unwrapped`() {
        val failure = IllegalStateException("not a Keystore failure")
        val cipher = TokenCipher { throw failure }
        val sealed = TokenCipher { k1 }.encrypt(plain)

        assertSame(failure, assertThrows(IllegalStateException::class.java) { cipher.encrypt(plain) })
        assertSame(failure, assertThrows(IllegalStateException::class.java) { cipher.decrypt(sealed) })
    }
}
