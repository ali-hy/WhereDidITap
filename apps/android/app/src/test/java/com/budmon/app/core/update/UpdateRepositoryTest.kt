// F-257 UpdateRepository: update states. TP-13.6.
//
// Shapes per A-344: UpdateRepository(api: MetaApi (the generated client), dataStore:
// DataStore<Preferences>, versionCode: Int, clock: java.time.Clock); refresh() is suspend;
// UpdateState is Required(min) / Available(latest) / None. ClientConfig and
// ClientConfigAndroid are the generated models (packageName com.budmon.api).
package com.budmon.app.core.update

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.test.core.app.ApplicationProvider
import com.budmon.api.apis.MetaApi
import com.budmon.api.models.ClientConfig
import com.budmon.api.models.ClientConfigAndroid
import com.budmon.api.models.ClientConfigWeb
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import retrofit2.Response
import java.io.File
import java.io.IOException
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

@RunWith(RobolectricTestRunner::class)
class UpdateRepositoryTest {
    private val start = Instant.parse("2026-10-07T12:00:00Z")

    private fun api(min: Int, latest: Int): MetaApi = mockk {
        coEvery { metaClientConfig() } returns Response.success(
            ClientConfig(
                apiVersion = "1.0",
                android = ClientConfigAndroid(minimumVersionCode = min, latestVersionCode = latest, downloadUrl = null),
                web = ClientConfigWeb(minimumBuild = 0),
            ),
        )
    }

    private fun TestScope.newStore(): DataStore<Preferences> {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val file = File(context.filesDir, "update-${System.nanoTime()}.preferences_pb")
        return PreferenceDataStoreFactory.create(scope = backgroundScope) { file }
    }

    private fun TestScope.repository(
        versionCode: Int,
        clock: () -> Clock,
        api: MetaApi = api(min = 5, latest = 7),
        store: DataStore<Preferences> = newStore(),
    ): UpdateRepository = UpdateRepository(
        api,
        store,
        versionCode,
        object : Clock() {
            override fun getZone() = ZoneOffset.UTC
            override fun withZone(zone: java.time.ZoneId?) = this
            override fun instant(): Instant = clock().instant()
        },
    )

    @Test
    fun `TP-13_6 min 5 latest 7 - version 4 is Required(5), 6 is Available(7), 7 is None`() = runTest {
        val fixed = Clock.fixed(start, ZoneOffset.UTC)
        val expected = mapOf(4 to UpdateState.Required(5), 6 to UpdateState.Available(7), 7 to UpdateState.None)

        for ((version, state) in expected) {
            val repo = repository(version) { fixed }
            repo.refresh()
            assertEquals("version $version", state, repo.state.value)
        }
    }

    @Test
    fun `TP-13_6 dismissing Available hides it, 3 days later it is Available again`() = runTest {
        var now = start
        val repo = repository(6) { Clock.fixed(now, ZoneOffset.UTC) }
        repo.refresh()
        assertEquals(UpdateState.Available(7), repo.state.value)

        repo.dismissAvailable()
        repo.refresh()
        assertEquals(UpdateState.None, repo.state.value)

        now = start.plus(Duration.ofDays(3)).plusSeconds(1)
        repo.refresh()
        assertEquals(UpdateState.Available(7), repo.state.value)
    }

    @Test
    fun `TP-13_6 markRequired(min) sets Required`() = runTest {
        val repo = repository(6) { Clock.fixed(start, ZoneOffset.UTC) }

        repo.markRequired(9)

        assertEquals(UpdateState.Required(9), repo.state.value)
    }

    // ---- A-471: markRequired persists; the stored minimum is the one source ----

    private val minimum = intPreferencesKey("minimumVersionCode")
    private val fixedClock = { Clock.fixed(start, ZoneOffset.UTC) }

    private suspend fun DataStore<Preferences>.storedMinimum(): Int? = data.first()[minimum]

    private suspend fun DataStore<Preferences>.storeMinimum(value: Int) {
        edit { it[minimum] = value }
    }

    private fun offline(): MetaApi = mockk { coEvery { metaClientConfig() } throws IOException("offline") }

    @Test
    fun `TP-13_6 (A-471) markRequired(6) over stored 3 is Required(6) and stores 6, and an offline refresh keeps it`() = runTest {
        val store = newStore()
        store.storeMinimum(3)
        val repo = repository(4, fixedClock, api = offline(), store = store)

        repo.markRequired(6)
        assertEquals(UpdateState.Required(6), repo.state.value)
        assertEquals(6, store.storedMinimum())

        repo.refresh()
        assertEquals(UpdateState.Required(6), repo.state.value)
    }

    @Test
    fun `TP-13_6 (A-471) a second repository on the same store starts None and current() reads Required(6)`() = runTest {
        val store = newStore()
        repository(4, fixedClock, api = offline(), store = store).markRequired(6)

        val cold = repository(4, fixedClock, api = offline(), store = store)
        assertEquals(UpdateState.None, cold.state.value)
        assertEquals(UpdateState.Required(6), cold.current())
        assertEquals(UpdateState.Required(6), cold.state.value)
    }

    @Test
    fun `TP-13_6 (A-471) markRequired(null) and markRequired(2) on an empty store are Required(versionCode + 1) and store 5`() = runTest {
        for (min in listOf<Int?>(null, 2)) {
            val store = newStore()
            val repo = repository(4, fixedClock, api = offline(), store = store)

            repo.markRequired(min)

            assertEquals("min $min", UpdateState.Required(5), repo.state.value)
            assertEquals("min $min", 5, store.storedMinimum())
        }
    }

    @Test
    fun `TP-13_6 (A-471) markRequired(6) then a refresh returning min 3 is None (the server lowered it)`() = runTest {
        val repo = repository(4, fixedClock, api = api(min = 3, latest = 4))

        repo.markRequired(6)
        repo.refresh()

        assertEquals(UpdateState.None, repo.state.value)
    }

    @Test
    fun `TP-13_6 (A-471) markRequired(7) after stored 9 keeps 9`() = runTest {
        val store = newStore()
        store.storeMinimum(9)
        val repo = repository(4, fixedClock, api = offline(), store = store)

        repo.markRequired(7)

        assertEquals(9, store.storedMinimum())
        assertEquals(UpdateState.Required(9), repo.state.value)
    }

    @Test
    fun `TP-13_6 (A-471) refresh recomputes from the store first - Required(5) shows before the API answers`() = runTest {
        val store = newStore()
        store.storeMinimum(5)
        val release = CompletableDeferred<Unit>()
        val slow: MetaApi = mockk {
            coEvery { metaClientConfig() } coAnswers {
                release.await()
                Response.success(
                    ClientConfig(
                        apiVersion = "1.0",
                        android = ClientConfigAndroid(minimumVersionCode = 5, latestVersionCode = 7, downloadUrl = null),
                        web = ClientConfigWeb(minimumBuild = 0),
                    ),
                )
            }
        }
        val repo = repository(4, fixedClock, api = slow, store = store)

        val pending = async { repo.refresh() }
        runCurrent()
        assertEquals(UpdateState.Required(5), repo.state.value)

        release.complete(Unit)
        pending.await()
        assertEquals(UpdateState.Required(5), repo.state.value)
    }

    // ---- A-473: a fetch succeeds only with a 2xx and a body ----

    @Test
    fun `TP-13_6 (A-473) Response error 500 and success(null) both keep the stored Required(5)`() = runTest {
        val answers: List<Response<ClientConfig>> = listOf(
            Response.error(500, "{}".toResponseBody()),
            Response.success(null),
        )
        for (answer in answers) {
            val store = newStore()
            store.storeMinimum(5)
            val api: MetaApi = mockk { coEvery { metaClientConfig() } returns answer }
            val repo = repository(4, fixedClock, api = api, store = store)

            repo.refresh()

            assertEquals(answer.code().toString(), UpdateState.Required(5), repo.state.value)
            assertEquals(5, store.storedMinimum())
        }
    }

    @Test
    fun `TP-13_6 (A-471) the constructor does no I-O - state is None until first used`() = runTest {
        val store = newStore()
        store.storeMinimum(9)

        val repo = repository(4, fixedClock, api = offline(), store = store)

        assertEquals(UpdateState.None, repo.state.value)
    }
}
