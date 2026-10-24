// F-264 API base URL and F-265 Google server client id: Gradle TestKit on the app module.
// TP-13.16 and TP-13.17. Each case runs a real Gradle build of apps/android, so it needs the Android
// SDK and runs only where the android job provides it.
//
// A-348: `testImplementation(gradleTestKit())` in app/build.gradle.kts, which also sets the system
// property `budmon.androidRoot`. Each case builds a temporary copy of apps/android (without build/,
// .gradle/ and local.properties), so it never contends with the outer build. The copy keeps the
// repository layout (<tmp>/apps/android) and brings the two files the build reads from outside
// apps/android: packages/contract/openapi.json (openApiGenerate) and packages/shared/test-vectors.
// AGP paths are in AgpPaths.kt.
package com.budmon.app.build

import org.gradle.testkit.runner.BuildResult
import org.gradle.testkit.runner.GradleRunner
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

class BuildPropertiesTest {
    private val source: File = File(checkNotNull(System.getProperty("budmon.androidRoot")) { "budmon.androidRoot not set" })
    private lateinit var base: File
    private lateinit var root: File

    /**
     * Review B-10: the nested build's own home (HOME and user.home), never the real one. One
     * directory for the class, emptied before each case, so every nested build has the same JVM
     * arguments and TestKit reuses one daemon.
     */
    private val home: File get() = sharedHome

    @Before
    fun copyProject() {
        base = Files.createTempDirectory("budmon-android-testkit-").toFile()
        root = File(base, "apps/android")
        val skip = setOf("build", ".gradle", "local.properties")
        source.walkTopDown()
            .onEnter { dir -> dir == source || dir.name !in skip }
            .filter { it.isFile && it.name !in skip }
            .forEach { file -> file.copyTo(File(root, file.relativeTo(source).path), overwrite = true) }
        File(root, "gradlew").setExecutable(true)
        val repo = source.resolve("../..").canonicalFile
        for (path in listOf("packages/contract/openapi.json", "packages/shared/test-vectors")) {
            repo.resolve(path).copyRecursively(base.resolve(path), overwrite = true)
        }
        home.deleteRecursively()
        home.mkdirs()
        // The nested daemon reads ~/.budmon/android.properties through user.home (F-264).
        val properties = File(root, "gradle.properties")
        val lines = properties.readLines().filterNot { it.startsWith("org.gradle.jvmargs=") }
        val jvmArgs = source.resolve("gradle.properties").readLines()
            .firstOrNull { it.startsWith("org.gradle.jvmargs=") }
            ?.removePrefix("org.gradle.jvmargs=")
            ?: ""
        properties.writeText((lines + "org.gradle.jvmargs=$jvmArgs -Duser.home=${home.path}").joinToString("\n", postfix = "\n"))
    }

    @After
    fun removeCopy() {
        base.deleteRecursively()
    }

    private fun gradle(vararg args: String): GradleRunner = GradleRunner.create()
        .withProjectDir(root)
        .withEnvironment(System.getenv() + ("HOME" to home.path))
        // The daemon also takes the client's system properties for each build, so user.home is
        // passed on the command line too; the jvmargs copy only keeps one daemon per home.
        .withArguments(*args, "-Duser.home=${home.path}", "--stacktrace", "-q")

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
    fun `TP-13_16 assembleRelease with https and a trailing slash succeeds, and BuildConfig has it, release permits no cleartext`() {
        succeeds(":app:assembleRelease", "-Pbudmon.apiBaseUrl=https://x.ts.net/")

        assertTrue(buildConfig("release").contains("API_BASE_URL = \"https://x.ts.net/\""))
        val config = networkConfig("release")
        assertTrue(!config.contains("cleartextTrafficPermitted=\"true\""))
    }

    @Test
    fun `TP-13_16 assembleDebug without the property uses http 10_0_2_2 5173, cleartext only to 10_0_2_2, localhost, 127_0_0_1 (A-349)`() {
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
    fun `TP-13_16 assembleDebug with port 8080 fails, with 3000 succeeds, with an https host fails`() {
        assertTrue(fails(":app:assembleDebug", "-Pbudmon.apiBaseUrl=http://10.0.2.2:8080/").output.contains("budmon.apiBaseUrl"))
        succeeds(":app:assembleDebug", "-Pbudmon.apiBaseUrl=http://10.0.2.2:3000/")
        assertTrue(buildConfig("debug").contains("API_BASE_URL = \"http://10.0.2.2:3000/\""))
        assertTrue(fails(":app:assembleDebug", "-Pbudmon.apiBaseUrl=https://x.ts.net/").output.contains("budmon.apiBaseUrl"))
    }

    // Review B-10, pinning B-1: the laptop file feeds release builds only.
    @Test
    fun `TP-13_16 with the laptop file present, release reads it and debug ignores it`() {
        File(home, ".budmon").mkdirs()
        File(home, ".budmon/android.properties").writeText("budmon.apiBaseUrl=https://laptop.tailnet.ts.net/\n")

        succeeds(":app:assembleRelease")
        assertTrue(buildConfig("release").contains("API_BASE_URL = \"https://laptop.tailnet.ts.net/\""))

        succeeds(":app:assembleDebug")
        assertTrue(buildConfig("debug").contains("API_BASE_URL = \"http://10.0.2.2:5173/\""))
    }

    // ---- TP-13.17 (F-265) ----

    @Test
    fun `TP-13_17 budmon_googleServerClientId is copied into BuildConfig, missing gives an empty string`() {
        succeeds(":app:assembleDebug", "-Pbudmon.googleServerClientId=123-abc.apps.googleusercontent.com")
        assertTrue(buildConfig("debug").contains("GOOGLE_SERVER_CLIENT_ID = \"123-abc.apps.googleusercontent.com\""))

        succeeds(":app:assembleDebug")
        assertTrue(buildConfig("debug").contains("GOOGLE_SERVER_CLIENT_ID = \"\""))
    }

    @Test
    fun `TP-13_17 an invalid id fails the build naming the property`() {
        assertTrue(fails(":app:assembleDebug", "-Pbudmon.googleServerClientId=abc").output.contains("budmon.googleServerClientId"))
    }

    private companion object {
        val sharedHome: File by lazy { Files.createTempDirectory("budmon-android-testkit-home-").toFile() }
    }
}
