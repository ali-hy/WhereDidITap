// F-250, A-347: start-up, as a seam tests call directly instead of varying BuildConfig.
package com.budmon.app.core.startup

import android.app.Application
import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.budmon.app.core.observability.SentryScrubber
import com.budmon.app.core.outbox.SyncWorker
import io.sentry.Sentry
import io.sentry.SentryOptions
import io.sentry.android.core.SentryAndroid
import io.sentry.android.core.SentryAndroidOptions
import java.util.concurrent.TimeUnit

object PlatformStartup {
    const val OUTBOX_SYNC = "outbox-sync"

    /** Sentry (when a DSN is configured), then the periodic outbox sync. */
    fun run(
        app: Application,
        sentryDsn: String,
        workManager: WorkManager,
        sentryInit: (Context, Sentry.OptionsConfiguration<SentryAndroidOptions>) -> Unit = { c, f ->
            SentryAndroid.init(c, f)
        },
    ) {
        if (sentryDsn.isNotEmpty()) {
            sentryInit(app) { options -> configureSentry(options, sentryDsn) }
        }
        workManager.enqueueUniquePeriodicWork(
            OUTBOX_SYNC,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build(),
        )
    }

    /** F-260's options: no PII, screenshots or view hierarchy; 20 scrubbed breadcrumbs. */
    fun configureSentry(options: SentryAndroidOptions, dsn: String) {
        options.dsn = dsn
        options.isSendDefaultPii = false
        options.isAttachScreenshot = false
        options.isAttachViewHierarchy = false
        options.maxBreadcrumbs = 20
        options.beforeSend = SentryScrubber()
        options.beforeBreadcrumb =
            SentryOptions.BeforeBreadcrumbCallback { crumb, _ -> SentryScrubber.scrubBreadcrumb(crumb) }
    }
}
