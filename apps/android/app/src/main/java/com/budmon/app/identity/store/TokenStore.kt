// F-201: the signed-in session and the device-level facts, encrypted at rest in a DataStore.
package com.budmon.app.identity.store

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import java.text.Normalizer
import java.time.DateTimeException
import java.time.Instant
import java.util.Base64
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/** datastore/identity_tokens.preferences_pb, which the backup rules already exclude (P-F-262). */
private val Context.identityTokens: DataStore<Preferences> by preferencesDataStore(name = "identity_tokens")

private val SESSION = stringPreferencesKey("session")
private val DEVICE = stringPreferencesKey("device")
private val LAST_EMAIL = stringPreferencesKey("last_email")
private val OUTBOX_OWNER = stringPreferencesKey("outbox_owner")
private val USED_GOOGLE = booleanPreferencesKey("used_google_before")

private const val FIELD_SEPARATOR = "\n"
private const val SESSION_FIELDS = 5
private const val DEVICE_FIELDS = 2

data class StoredSession(
    val accessToken: String,
    val refreshToken: String,
    val accessExpiresAt: Instant,
    val refreshExpiresAt: Instant,
    val userId: String,
)

/** The email as the server compares it: NFC, trimmed, lower case. */
private fun normalise(email: String): String = Normalizer.normalize(email, Normalizer.Form.NFC).trim().lowercase(Locale.ROOT)

/**
 * Every accessor that decrypts catches an unreadable value itself, resets the whole store and
 * returns null, so callers never see the exception.
 */
@Singleton
class TokenStore
    @Inject
    constructor(
        @ApplicationContext context: Context,
        private val cipher: TokenCipher,
    ) {
        private val store = context.identityTokens

        private fun seal(text: String): String = Base64.getEncoder().encodeToString(cipher.encrypt(text.toByteArray(Charsets.UTF_8)))

        private fun open(sealed: String): String = String(cipher.decrypt(Base64.getDecoder().decode(sealed)), Charsets.UTF_8)

        /** The decrypted value of [key], or null when absent or unreadable (the store is then reset). */
        private suspend fun <T> readValue(
            key: Preferences.Key<String>,
            parse: (String) -> T?,
        ): T? {
            val sealed = store.data.first()[key] ?: return null
            return try {
                parse(open(sealed))
            } catch (_: TokenCipherException) {
                resetAll()
                null
            } catch (_: IllegalArgumentException) {
                resetAll()
                null
            } catch (_: DateTimeException) {
                resetAll()
                null
            }
        }

        suspend fun read(): StoredSession? =
            readValue(SESSION) { text ->
                val fields = text.split(FIELD_SEPARATOR)
                if (fields.size != SESSION_FIELDS) {
                    throw IllegalArgumentException("session fields")
                }
                StoredSession(fields[0], fields[1], Instant.parse(fields[2]), Instant.parse(fields[3]), fields[4])
            }

        suspend fun save(s: StoredSession) {
            val sealed =
                seal(
                    listOf(s.accessToken, s.refreshToken, s.accessExpiresAt.toString(), s.refreshExpiresAt.toString(), s.userId)
                        .joinToString(FIELD_SEPARATOR),
                )
            store.edit { it[SESSION] = sealed }
        }

        /** Removes only the session: the device token, last email, Google flag and outbox owner stay. */
        suspend fun clear() {
            store.edit { it.remove(SESSION) }
        }

        suspend fun deviceTokenFor(email: String): String? =
            readValue(DEVICE) { text ->
                val fields = text.split(FIELD_SEPARATOR)
                if (fields.size != DEVICE_FIELDS) {
                    throw IllegalArgumentException("device fields")
                }
                fields[1].takeIf { fields[0] == normalise(email) }
            }

        /** One entry: saving for another email replaces it. */
        suspend fun saveDeviceToken(
            email: String,
            token: String,
        ) {
            val sealed = seal(normalise(email) + FIELD_SEPARATOR + token)
            store.edit { it[DEVICE] = sealed }
        }

        suspend fun lastEmail(): String? = readValue(LAST_EMAIL) { it }

        suspend fun saveLastEmail(email: String) {
            val sealed = seal(email)
            store.edit { it[LAST_EMAIL] = sealed }
        }

        suspend fun usedGoogleBefore(): Boolean = store.data.first()[USED_GOOGLE] ?: false

        suspend fun setUsedGoogleBefore(v: Boolean) {
            store.edit { it[USED_GOOGLE] = v }
        }

        suspend fun outboxOwnerUserId(): String? = readValue(OUTBOX_OWNER) { it }

        /** Null removes the owner. */
        suspend fun setOutboxOwnerUserId(id: String?) {
            if (id == null) {
                store.edit { it.remove(OUTBOX_OWNER) }
            } else {
                val sealed = seal(id)
                store.edit { it[OUTBOX_OWNER] = sealed }
            }
        }

        suspend fun resetAll() {
            store.edit { it.clear() }
        }
    }
