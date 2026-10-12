// F-257 UpdateRepository: update states. TP-13.6.
//
// Shapes per A-344: UpdateRepository(api: MetaApi (the generated client), dataStore:
// DataStore<Preferences>, versionCode: Int, clock: java.time.Clock); refresh() is suspend;
// UpdateState is Required(min) / Available(latest) / None. ClientConfig and
// ClientConfigAndroid are the generated models (packageName com.budmon.api).
package com.budmon.app.core.update

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import com.budmon.api.apis.MetaApi
import com.budmon.api.models.ClientConfig
import com.budmon.api.models.ClientConfigAndroid
import com.budmon.api.models.ClientConfigWeb
import io.mockk.coEvery
import io.mockk.mockk
import java.io.File
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import retrofit2.Response

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

    private fun TestScope.repository(versionCode: Int, clock: () -> Clock): UpdateRepository {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val file = File(context.filesDir, "update-$versionCode-${System.nanoTime()}.preferences_pb")
        val store = PreferenceDataStoreFactory.create(scope = backgroundScope) { file }
        return UpdateRepository(api(min = 5, latest = 7), store, versionCode, object : Clock() {
            override fun getZone() = ZoneOffset.UTC
            override fun withZone(zone: java.time.ZoneId?) = this
            override fun instant(): Instant = clock().instant()
        })
    }

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
    fun `TP-13_6 dismissing Available hides it; 3 days later it is Available again`() = runTest {
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
}
