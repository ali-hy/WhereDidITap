// TP-13.21 (A-543): ktlint wiring in the root build.gradle.kts, through Gradle TestKit on a copy
// (AndroidProjectCopy.kt).
// - ktlintCheck covers :app's source sets, not only :lint-rules'.
// - A file under its own subproject's build directory is never linted.
// No -q: dry-run lines and ktlint's console report are lifecycle/warn output.
package com.budmon.app.build

import org.gradle.testkit.runner.TaskOutcome
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

class KtlintWiringTest {
    private val source: File = File(checkNotNull(System.getProperty("budmon.androidRoot")) { "budmon.androidRoot not set" })
    private lateinit var copy: AndroidProjectCopy

    @Before
    fun copyProject() {
        copy = AndroidProjectCopy(source, sharedHome)
    }

    @After
    fun removeCopy() {
        copy.delete()
    }

    @Test
    fun `TP-13_21 ktlintCheck runs app's main and test source-set checks and lint-rules' main check`() {
        val result = copy.runner("ktlintCheck", "--dry-run").build()

        val lines = result.output.lines().map { it.trim() }
        val expected = listOf(
            ":app:runKtlintCheckOverMainSourceSet SKIPPED",
            ":app:ktlintMainSourceSetCheck SKIPPED",
            ":app:runKtlintCheckOverTestSourceSet SKIPPED",
            ":app:ktlintTestSourceSetCheck SKIPPED",
            ":lint-rules:ktlintMainSourceSetCheck SKIPPED",
        )
        for (line in expected) {
            assertTrue("missing \"$line\" in:\n${result.output}", line in lines)
        }
    }

    @Test
    fun `TP-13_21 a violation in app src main fails the main check, one in the build directory is not linted`() {
        plant("app/src/main/java/zz", "PlantedSrc.kt")
        plant("app/build/generated/openapi/src/main/kotlin/zz", "PlantedGenerated.kt")

        // --rerun-tasks: the filter isn't in the task's cache key, so a cached result could hide it.
        // -x openApiGenerate: it clears its output directory, which would delete the planted file.
        val result = copy.runner(":app:ktlintMainSourceSetCheck", "--rerun-tasks", "-x", ":app:openApiGenerate").buildAndFail()

        assertEquals(result.output, TaskOutcome.FAILED, result.task(":app:ktlintMainSourceSetCheck")?.outcome)
        val reports = File(copy.root, "app/build/reports/ktlint").walkTopDown().filter { it.isFile }.map { it.readText() }
        val text = (sequenceOf(result.output) + reports).joinToString("\n")
        assertTrue(text, text.contains("PlantedSrc.kt"))
        assertFalse(text, text.contains("PlantedGenerated.kt"))
        // The exclusion only counts if the planted file was there to lint.
        assertTrue(File(copy.root, "app/build/generated/openapi/src/main/kotlin/zz/PlantedGenerated.kt").exists())
    }

    /** Writes a file breaking the standard rule `no-semi` into [dir] of the copy. */
    private fun plant(dir: String, name: String) {
        val directory = File(copy.root, dir).apply { mkdirs() }
        File(directory, name).writeText("package zz\n\nval planted = 1;\n")
    }

    private companion object {
        // One home for the class, so both nested builds share a daemon.
        val sharedHome: File by lazy { Files.createTempDirectory("budmon-android-testkit-home-").toFile() }
    }
}
