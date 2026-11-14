// F-200 TokenCipher (identity LLD §4.15, A-7). TP-0.29 (a), plus extra cases TP-0.29x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Shapes per A-7: TokenCipher's internal constructor takes the key provider `() -> SecretKey`
// (called per operation, so Robolectric never touches the Android Keystore); encrypt's output is
// IV(12) ‖ ciphertext ‖ 128-bit tag; TokenCipherException(cause) is in the same package.
package com.budmon.app.identity.store

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
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
}
