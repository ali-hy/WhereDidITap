// A temporary copy of apps/android for the TestKit cases (A-348, A-543), so a nested build never
// contends with the outer one.
// - Keeps the repository layout (<base>/apps/android), without build/, .gradle/ and local.properties.
// - Brings what the build reads from outside apps/android: packages/contract/openapi.json and
//   packages/shared/test-vectors.
// - The nested build gets its own home (HOME and user.home), emptied here, never the real one.
package com.budmon.app.build

import org.gradle.testkit.runner.GradleRunner
import java.io.File
import java.nio.file.Files

internal class AndroidProjectCopy(source: File, private val home: File) {
    private val base: File = Files.createTempDirectory("budmon-android-testkit-").toFile()

    /** The copy's apps/android directory. */
    val root: File = File(base, "apps/android")

    init {
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

    /** A runner on the copy with [args], the nested home and `--stacktrace`. */
    fun runner(vararg args: String): GradleRunner = GradleRunner.create()
        .withProjectDir(root)
        .withEnvironment(System.getenv() + ("HOME" to home.path))
        // The daemon also takes the client's system properties for each build, so user.home is
        // passed on the command line too; the jvmargs copy only keeps one daemon per home.
        .withArguments(*args, "-Duser.home=${home.path}", "--stacktrace")

    /** Removes the whole copy. */
    fun delete() {
        base.deleteRecursively()
    }
}
