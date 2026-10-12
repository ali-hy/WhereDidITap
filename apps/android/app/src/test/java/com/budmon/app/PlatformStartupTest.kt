// F-250 start-up through the A-347 seam: PlatformStartup.run(app, sentryDsn, workManager, sentryInit),
// which BudmonApp.onCreate calls with BuildConfig.SENTRY_DSN. TP-13.14.
//
// Assumed: sentryInit has SentryAndroid.init's shape, (Context, Sentry.OptionsConfiguration<
// SentryAndroidOptions>) -> Unit.
package com.budmon.app

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import com.budmon.app.core.observability.SentryScrubber
import io.sentry.Sentry
import io.sentry.android.core.SentryAndroidOptions
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PlatformStartupTest {
    private lateinit var app: Application
    private lateinit var workManager: WorkManager
    private val recorded = mutableListOf<Sentry.OptionsConfiguration<SentryAndroidOptions>>()
    private val sentryInit: (android.content.Context, Sentry.OptionsConfiguration<SentryAndroidOptions>) -> Unit =
        { _, configure -> recorded.add(configure) }

    @Before
    fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(app, Configuration.Builder().build())
        workManager = WorkManager.getInstance(app)
        recorded.clear()
    }

    private fun assertOutboxSyncEnqueued() {
        val infos = workManager.getWorkInfosForUniqueWork("outbox-sync").get()
        assertEquals(1, infos.size)
        val info = infos.single()
        assertEquals(WorkInfo.State.ENQUEUED, info.state)
        assertEquals(NetworkType.CONNECTED, info.constraints.requiredNetworkType)
        assertEquals(TimeUnit.MINUTES.toMillis(15), info.periodicityInfo?.repeatIntervalMillis)
    }

    @Test
    fun `TP-13_14 an empty DSN doesn't call sentryInit; outbox-sync is enqueued every 15 minutes, CONNECTED`() {
        PlatformStartup.run(app, "", workManager, sentryInit)

        assertTrue(recorded.isEmpty())
        assertOutboxSyncEnqueued()
    }

    @Test
    fun `TP-13_14 a DSN calls sentryInit once with F-260's options; outbox-sync is enqueued`() {
        val dsn = "https://k@o1.ingest.sentry.io/1"

        PlatformStartup.run(app, dsn, workManager, sentryInit)

        assertEquals(1, recorded.size)
        val options = SentryAndroidOptions()
        recorded.single().configure(options)
        assertEquals(dsn, options.dsn)
        assertFalse(options.isSendDefaultPii)
        assertFalse(options.isAttachScreenshot)
        assertFalse(options.isAttachViewHierarchy)
        assertEquals(20, options.maxBreadcrumbs)
        assertTrue(options.beforeSend is SentryScrubber)
        assertOutboxSyncEnqueued()
    }
}
