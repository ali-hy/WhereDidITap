// P-A-513 (6), P-A-516 (a), (b): ThemeSetting and ThemeSettingStore. TP-0b.9 (the store), plus extra
// cases TP-0b.9x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Shapes per P-A-516: ThemeSetting(wire) { SYSTEM, LIGHT, DARK } with fromWire; ThemeSettingStore's
// internal constructor takes the DataStore<Preferences>; the value is stringPreferencesKey("theme")
// holding `wire`.
package com.budmon.app.ui.theme

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class ThemeSettingStoreTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val key = stringPreferencesKey("theme")

    /** A DataStore on its own temporary file, and a store over it. */
    private fun fresh(): Pair<DataStore<Preferences>, ThemeSettingStore> {
        val dataStore = PreferenceDataStoreFactory.create(
            scope = scope,
            produceFile = { File(folder.newFolder(), "ui_prefs.preferences_pb") },
        )
        return dataStore to ThemeSettingStore(dataStore)
    }

    @After
    fun tearDown() {
        scope.cancel()
    }

    @Test
    fun `TP-0b_9 set then setting round-trips each value`() = runTest {
        for (value in ThemeSetting.entries) {
            val (_, store) = fresh()

            store.set(value)

            assertEquals(value, store.setting.first())
        }
    }

    @Test
    fun `TP-0b_9 purple written to the theme key directly reads as SYSTEM`() = runTest {
        val (dataStore, store) = fresh()

        dataStore.edit { it[key] = "purple" }

        assertEquals(ThemeSetting.SYSTEM, store.setting.first())
    }

    @Test
    fun `TP-0b_9x with nothing stored the setting is SYSTEM`() = runTest {
        val (dataStore, store) = fresh()

        assertNull(dataStore.data.first()[key])
        assertEquals(ThemeSetting.SYSTEM, store.setting.first())
    }

    @Test
    fun `TP-0b_9x set stores the wire value under the theme key`() = runTest {
        val (dataStore, store) = fresh()

        store.set(ThemeSetting.DARK)
        assertEquals("dark", dataStore.data.first()[key])

        store.set(ThemeSetting.LIGHT)
        assertEquals("light", dataStore.data.first()[key])

        store.set(ThemeSetting.SYSTEM)
        assertEquals("system", dataStore.data.first()[key])
    }

    @Test
    fun `TP-0b_9x the wire values are system, light and dark`() {
        assertEquals(listOf("system", "light", "dark"), ThemeSetting.entries.map { it.wire })
    }

    @Test
    fun `TP-0b_9x fromWire maps the three values and everything else, null included, to SYSTEM`() {
        assertEquals(ThemeSetting.SYSTEM, ThemeSetting.fromWire("system"))
        assertEquals(ThemeSetting.LIGHT, ThemeSetting.fromWire("light"))
        assertEquals(ThemeSetting.DARK, ThemeSetting.fromWire("dark"))
        assertEquals(ThemeSetting.SYSTEM, ThemeSetting.fromWire("purple"))
        assertEquals(ThemeSetting.SYSTEM, ThemeSetting.fromWire("DARK"))
        assertEquals(ThemeSetting.SYSTEM, ThemeSetting.fromWire(""))
        assertEquals(ThemeSetting.SYSTEM, ThemeSetting.fromWire(null))
    }
}
