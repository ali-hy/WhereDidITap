// F-257: whether this build must, or may, be updated, from meta/client-config.
package com.budmon.app.core.update

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.budmon.api.apis.MetaApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.SerializationException
import java.io.IOException
import java.time.Clock
import java.time.Duration
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

sealed interface UpdateState {
    data class Required(val min: Int) : UpdateState

    data class Available(val latest: Int) : UpdateState

    data object None : UpdateState
}

@Singleton
class UpdateRepository
@Inject
constructor(
    private val api: MetaApi,
    private val dataStore: DataStore<Preferences>,
    @Named("versionCode") private val versionCode: Int,
    private val clock: Clock,
) {
    private val current = MutableStateFlow<UpdateState>(UpdateState.None)
    val state: StateFlow<UpdateState> = current.asStateFlow()

    private val download = MutableStateFlow<String?>(null)

    /** The APK download URL from the last client-config, if any. */
    val downloadUrl: StateFlow<String?> = download.asStateFlow()

    /**
     * A-471: recomputes from what's stored first (so a stored Required shows before the network
     * answers), then fetches client-config, stores it as returned, and recomputes again; a failed
     * fetch keeps what's stored.
     */
    suspend fun refresh() {
        recompute()
        try {
            val response = api.metaClientConfig()
            val body = response.body()
            if (response.isSuccessful && body != null) {
                dataStore.edit {
                    it[MINIMUM] = body.android.minimumVersionCode
                    it[LATEST] = body.android.latestVersionCode
                    val url = body.android.downloadUrl
                    if (url == null) it.remove(DOWNLOAD_URL) else it[DOWNLOAD_URL] = url
                }
            }
        } catch (_: IOException) {
            // Offline: the stored values decide.
        } catch (_: SerializationException) {
            // An unexpected body: the stored values decide.
        }
        recompute()
    }

    /** A-471: the state from DataStore, emitted to [state] and returned. */
    suspend fun current(): UpdateState {
        recompute()
        return current.value
    }

    /**
     * A-471: the server refused this build (CLIENT_UPDATE_REQUIRED), so Required holds even without a
     * usable minimum: stores max(stored, max(min ?: 0, versionCode + 1)).
     */
    suspend fun markRequired(min: Int?) {
        val above = (versionCode.toLong() + 1).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        val effective = maxOf(min ?: 0, above)
        dataStore.edit { it[MINIMUM] = maxOf(it[MINIMUM] ?: 0, effective) }
        recompute()
    }

    /** "Later" hides Available for three days. */
    suspend fun dismissAvailable() {
        dataStore.edit { it[DISMISSED_AT] = clock.millis() }
        recompute()
    }

    private suspend fun recompute() {
        val prefs = dataStore.data.first()
        val minimum = prefs[MINIMUM] ?: 0
        val latest = prefs[LATEST] ?: 0
        download.value = prefs[DOWNLOAD_URL]
        val dismissedAt = prefs[DISMISSED_AT]
        val dismissed = dismissedAt != null && clock.millis() - dismissedAt < DISMISS_FOR.toMillis()
        current.value =
            when {
                versionCode < minimum -> UpdateState.Required(minimum)
                versionCode < latest && !dismissed -> UpdateState.Available(latest)
                else -> UpdateState.None
            }
    }

    private companion object {
        val MINIMUM = intPreferencesKey("minimumVersionCode")
        val LATEST = intPreferencesKey("latestVersionCode")
        val DOWNLOAD_URL = stringPreferencesKey("downloadUrl")
        val DISMISSED_AT = longPreferencesKey("availableDismissedAtMs")
        val DISMISS_FOR: Duration = Duration.ofDays(3)
    }
}
