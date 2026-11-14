// The instrumentation runner build.gradle.kts names (testInstrumentationRunner): it starts
// HiltTestApplication instead of BudmonApp, so @HiltAndroidTest classes such as TP-13.13's
// UpdateRequiredSmokeTest get a test component with their @TestInstallIn replacements.
package com.budmon.app

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner
import dagger.hilt.android.testing.HiltTestApplication

class HiltTestRunner : AndroidJUnitRunner() {
    override fun newApplication(cl: ClassLoader?, className: String?, context: Context?): Application =
        super.newApplication(cl, HiltTestApplication::class.java.name, context)
}
