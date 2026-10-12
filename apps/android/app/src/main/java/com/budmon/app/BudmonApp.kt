// F-250: the application: Sentry, Hilt's WorkManager configuration, then the periodic sync.
package com.budmon.app

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import androidx.work.WorkManager
import com.budmon.app.core.startup.PlatformStartup
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class BudmonApp :
    Application(),
    Configuration.Provider {
    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        PlatformStartup.run(app = this, sentryDsn = BuildConfig.SENTRY_DSN, workManager = WorkManager.getInstance(this))
    }
}
