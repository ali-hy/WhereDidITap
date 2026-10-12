// F-264 API base URL and F-265 Google server client id: Gradle TestKit on the app module.
// TP-13.16 and TP-13.17. Each case runs a real Gradle build of apps/android, so it needs the Android
// SDK and runs only where the android job provides it.
//
// A-348: `testImplementation(gradleTestKit())` in app/build.gradle.kts, which also sets the system
// property `budmon.androidRoot`. Each case builds a temporary copy of apps/android (without build/,
// .gradle/ and local.properties), so it never contends with the outer build. AGP paths are in
// AgpPaths.kt.
package com.budmon.app.build

import java.io.File
import java.nio.file.Files
import org.gradle.testkit.runner.BuildResult
import org.gradle.testkit.runner.GradleRunner
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class BuildPropertiesTest {
    private val source: File = File(checkNotNull(System.getProperty("budmon.androidRoot")) { "budmon.androidRoot not set" })
    private lateinit var root: File

    @Before
    fun copyProject() {
        root = Files.createTempDirectory("budmon-android-testkit-").toFile()
        val skip = setOf("build", ".gradle", "local.properties")
        source.walkTopDown()
            .onEnter { dir -> dir == source || dir.name !in skip }
            .filter { it.isFile && it.name !in skip }
            .forEach { file -> file.copyTo(File(root, file.relativeTo(source).path), overwrite = true) }
        File(root, "gradlew").setExecutable(true)
    }

    @After
    fun removeCopy() {
        root.deleteRecursively()
    }

    private fun gradle(vararg args: String): GradleRunner =
        GradleRunner.create().withProjectDir(root).withArguments(*args, "--stacktrace", "-q")

    private fun fails(vararg args: String): BuildResult = gradle(*args).buildAndFail()
    private fun succeeds(vararg args: String): BuildResult = gradle(*args).build()

    private fun buildConfig(variant: String): String = AgpPaths.buildConfig(root, variant).readText()

    private fun mergedManifest(variant: String): String = AgpPaths.mergedManifest(root, variant).readText()

    private fun networkConfig(variant: String): String = AgpPaths.networkSecurityConfig(root, variant).readText()

    // ---- TP-13.16 (F-264) ----

    @Test
    fun `TP-13_16 assembleRelease without budmon_apiBaseUrl fails naming the property`() {
        assertTrue(fails(":app:assembleRelease").output.contains("budmon.apiBaseUrl"))
    }

    @Test
    fun `TP-13_16 assembleRelease with http or without a trailing slash fails naming the property`() {
        for (url in listOf("http://x/", "https://x.ts.net")) {
            assertTrue(url, fails(":app:assembleRelease", "-Pbudmon.apiBaseUrl=$url").output.contains("budmon.apiBaseUrl"))
        }
    }

    @Test
    fun `TP-13_16 assembleRelease with https and a trailing slash succeeds, and BuildConfig has it; release permits no cleartext`() {
        succeeds(":app:assembleRelease", "-Pbudmon.apiBaseUrl=https://x.ts.net/")

        assertTrue(buildConfig("release").contains("API_BASE_URL = \"https://x.ts.net/\""))
        val config = networkConfig("release")
        assertTrue(!config.contains("cleartextTrafficPermitted=\"true\""))
    }

    @Test
    fun `TP-13_16 assembleDebug without the property uses http 10_0_2_2 5173; cleartext only to 10_0_2_2, localhost and 127_0_0_1 (A-349)`() {
        succeeds(":app:assembleDebug")

        assertTrue(buildConfig("debug").contains("API_BASE_URL = \"http://10.0.2.2:5173/\""))
        val config = networkConfig("debug")
        val domains = Regex("<domain[^>]*>([^<]+)</domain>").findAll(config).map { it.groupValues[1].trim() }.toSet()
        assertTrue(domains.toString(), domains == setOf("10.0.2.2", "localhost", "127.0.0.1"))
        assertTrue(Regex("cleartextTrafficPermitted=\"true\"").findAll(config).count() >= 1)
        assertTrue(!Regex("<base-config[^>]*cleartextTrafficPermitted=\"true\"").containsMatchIn(config))
        assertTrue(mergedManifest("debug").contains("networkSecurityConfig"))
    }

    @Test
    fun `TP-13_16 assembleDebug with port 8080 fails; with 3000 succeeds; with an https host fails`() {
        assertTrue(fails(":app:assembleDebug", "-Pbudmon.apiBaseUrl=http://10.0.2.2:8080/").output.contains("budmon.apiBaseUrl"))
        succeeds(":app:assembleDebug", "-Pbudmon.apiBaseUrl=http://10.0.2.2:3000/")
        assertTrue(buildConfig("debug").contains("API_BASE_URL = \"http://10.0.2.2:3000/\""))
        assertTrue(fails(":app:assembleDebug", "-Pbudmon.apiBaseUrl=https://x.ts.net/").output.contains("budmon.apiBaseUrl"))
    }

    // ---- TP-13.17 (F-265) ----

    @Test
    fun `TP-13_17 budmon_googleServerClientId is copied into BuildConfig; missing gives an empty string`() {
        succeeds(":app:assembleDebug", "-Pbudmon.googleServerClientId=123-abc.apps.googleusercontent.com")
        assertTrue(buildConfig("debug").contains("GOOGLE_SERVER_CLIENT_ID = \"123-abc.apps.googleusercontent.com\""))

        succeeds(":app:assembleDebug")
        assertTrue(buildConfig("debug").contains("GOOGLE_SERVER_CLIENT_ID = \"\""))
    }

    @Test
    fun `TP-13_17 an invalid id fails the build naming the property`() {
        assertTrue(fails(":app:assembleDebug", "-Pbudmon.googleServerClientId=abc").output.contains("budmon.googleServerClientId"))
    }
}
