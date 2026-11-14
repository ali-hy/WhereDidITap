// P-A-516 (a), (b): the appearance setting and its device cache (guide §3.5).
package com.budmon.app.ui.theme

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.IOException
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

enum class ThemeSetting(
    val wire: String,
) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark"),
    ;

    companion object {
        /** Anything else, `null` included, is [SYSTEM]. */
        fun fromWire(s: String?): ThemeSetting = entries.firstOrNull { it.wire == s } ?: SYSTEM
    }
}

private val Context.uiPrefs: DataStore<Preferences> by preferencesDataStore(
    name = "ui_prefs",
    corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
)

private val THEME = stringPreferencesKey("theme")

/** The device's last appearance setting; signed-out screens and the next launch read it. */
@Singleton
class ThemeSettingStore
    internal constructor(
        private val dataStore: DataStore<Preferences>,
    ) {
        @Inject
        constructor(
            @ApplicationContext context: Context,
        ) : this(context.uiPrefs)

        /** Absent, unknown or unreadable is [ThemeSetting.SYSTEM]. */
        val setting: Flow<ThemeSetting> =
            dataStore.data
                .catch { e ->
                    if (e is IOException) emit(emptyPreferences()) else throw e
                }.map { ThemeSetting.fromWire(it[THEME]) }

        suspend fun set(s: ThemeSetting) {
            dataStore.edit { it[THEME] = s.wire }
        }
    }
