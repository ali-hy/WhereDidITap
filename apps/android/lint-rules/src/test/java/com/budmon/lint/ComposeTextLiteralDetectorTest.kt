// F-261 ComposeTextLiteralDetector (BudmonHardcodedComposeText). TP-13.10.
//
// Assumed: the issue is exposed as ComposeTextLiteralDetector.ISSUE.
package com.budmon.lint

import com.android.tools.lint.checks.infrastructure.LintDetectorTest
import com.android.tools.lint.checks.infrastructure.TestFile
import com.android.tools.lint.detector.api.Detector
import com.android.tools.lint.detector.api.Issue

class ComposeTextLiteralDetectorTest : LintDetectorTest() {
    override fun getDetector(): Detector = ComposeTextLiteralDetector()

    override fun getIssues(): List<Issue> = listOf(ComposeTextLiteralDetector.ISSUE)

    private val stubs: Array<TestFile> = arrayOf(
        kotlin(
            """
            package androidx.compose.material3
            import androidx.compose.runtime.Composable
            @Composable fun Text(text: String) {}
            @Composable fun Icon(imageVector: Any, contentDescription: String?) {}
            """,
        ).indented(),
        kotlin(
            """
            package androidx.compose.runtime
            annotation class Composable
            """,
        ).indented(),
        kotlin(
            """
            package androidx.compose.ui.res
            fun stringResource(id: Int): String = ""
            """,
        ).indented(),
        kotlin(
            """
            package com.example
            object R { object string { const val x = 1 } }
            """,
        ).indented(),
    )

    fun `test TP-13_10 Text("Hello") is an error`() {
        lint().files(
            *stubs,
            kotlin(
                """
                package com.example
                import androidx.compose.material3.Text
                import androidx.compose.runtime.Composable
                @Composable fun Screen() { Text("Hello") }
                """,
            ).indented(),
        ).run().expectErrorCount(1).expectContains("BudmonHardcodedComposeText")
    }

    fun `test TP-13_10 Text(stringResource(R_string_x)) is ok`() {
        lint().files(
            *stubs,
            kotlin(
                """
                package com.example
                import androidx.compose.material3.Text
                import androidx.compose.runtime.Composable
                import androidx.compose.ui.res.stringResource
                @Composable fun Screen() { Text(stringResource(R.string.x)) }
                """,
            ).indented(),
        ).run().expectClean()
    }

    fun `test TP-13_10 Icon with contentDescription = "x" is an error`() {
        lint().files(
            *stubs,
            kotlin(
                """
                package com.example
                import androidx.compose.material3.Icon
                import androidx.compose.runtime.Composable
                @Composable fun Screen(v: Any) { Icon(v, contentDescription = "x") }
                """,
            ).indented(),
        ).run().expectErrorCount(1).expectContains("BudmonHardcodedComposeText")
    }

    fun `test TP-13_10 a string template in Text is an error; a variable is ok`() {
        lint().files(
            *stubs,
            kotlin(
                """
                package com.example
                import androidx.compose.material3.Text
                import androidx.compose.runtime.Composable
                @Composable fun A(n: Int) { Text("${'$'}n items") }
                @Composable fun B(label: String) { Text(label) }
                """,
            ).indented(),
        ).run().expectErrorCount(1)
    }
}
