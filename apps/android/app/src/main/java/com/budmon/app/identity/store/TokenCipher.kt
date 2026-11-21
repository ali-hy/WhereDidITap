// F-200: AES-256-GCM over the Android Keystore, for the tokens stored on the phone.
package com.budmon.app.identity.store

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

/** A value couldn't be encrypted or decrypted: a tampered byte, another key, or a Keystore that failed. */
class TokenCipherException(cause: Throwable) : Exception(cause)

private const val KEY_ALIAS = "budmon_tokens"
private const val IV_BYTES = 12
private const val TAG_BITS = 128
private const val MIN_SEALED_BYTES = IV_BYTES + TAG_BITS / 8
private const val TRANSFORMATION = "AES/GCM/NoPadding"

/** The Keystore key, generated on first use. */
private fun keystoreKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val spec =
        KeyGenParameterSpec
            .Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
    return KeyGenerator
        .getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        .apply { init(spec) }
        .generateKey()
}

/** The key comes from [key] on every operation, so a test passes an in-memory key. */
@Singleton
class TokenCipher internal constructor(
    private val key: () -> SecretKey,
) {
    @Inject
    constructor() : this(::keystoreKey)

    /** IV (12 bytes) followed by the ciphertext and its 128-bit tag. */
    fun encrypt(plain: ByteArray): ByteArray =
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            cipher.iv + cipher.doFinal(plain)
        } catch (e: GeneralSecurityException) {
            throw TokenCipherException(e)
        } catch (e: IOException) {
            throw TokenCipherException(e)
        } catch (e: ProviderException) {
            throw TokenCipherException(e)
        }

    fun decrypt(data: ByteArray): ByteArray {
        if (data.size < MIN_SEALED_BYTES) throw TokenCipherException(IllegalArgumentException("sealed value too short"))
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, data, 0, IV_BYTES))
            cipher.doFinal(data, IV_BYTES, data.size - IV_BYTES)
        } catch (e: GeneralSecurityException) {
            throw TokenCipherException(e)
        } catch (e: IOException) {
            throw TokenCipherException(e)
        } catch (e: ProviderException) {
            throw TokenCipherException(e)
        }
    }
}
