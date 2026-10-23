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
            object R {
                object string { const val x = 1 }
                object plurals { const val p = 2 }
            }
            """,
        ).indented(),
        kotlin(
            """
            package androidx.compose.foundation.text
            import androidx.compose.runtime.Composable
            @Composable fun BasicText(text: String) {}
            """,
        ).indented(),
        kotlin(
            """
            package androidx.compose.ui
            interface Modifier { companion object : Modifier }
            """,
        ).indented(),
        kotlin(
            """
            package androidx.compose.ui.semantics
            import androidx.compose.ui.Modifier
            interface SemanticsPropertyReceiver
            var SemanticsPropertyReceiver.contentDescription: String
                get() = ""
                set(value) {}
            fun Modifier.semantics(properties: SemanticsPropertyReceiver.() -> Unit): Modifier = this
            """,
        ).indented(),
        kotlin(
            """
            package androidx.compose.ui.res
            fun pluralStringResource(id: Int, count: Int, vararg formatArgs: Any): String = ""
            """,
        ).indented(),
    )

    fun testTp1310TextHelloIsAnError() {
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

    fun testTp1310TextStringResourceIsOk() {
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

    fun testTp1310IconContentDescriptionLiteralIsAnError() {
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

    fun testTp1310StringTemplateInTextIsAnErrorVariableIsOk() {
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

    // Review B-11: F-261's other report sites, and the allowed plural resource.
    fun testTp1310BasicTextHelloIsAnError() {
        lint().files(
            *stubs,
            kotlin(
                """
                package com.example
                import androidx.compose.foundation.text.BasicText
                import androidx.compose.runtime.Composable
                @Composable fun Screen() { BasicText("x") }
                """,
            ).indented(),
        ).run().expectErrorCount(1).expectContains("BudmonHardcodedComposeText")
    }

    fun testTp1310SemanticsContentDescriptionLiteralIsAnError() {
        lint().files(
            *stubs,
            kotlin(
                """
                package com.example
                import androidx.compose.runtime.Composable
                import androidx.compose.ui.Modifier
                import androidx.compose.ui.semantics.contentDescription
                import androidx.compose.ui.semantics.semantics
                @Composable fun Screen() { val m = Modifier.semantics { contentDescription = "x" } }
                """,
            ).indented(),
        ).run().expectErrorCount(1).expectContains("BudmonHardcodedComposeText")
    }

    fun testTp1310TextPluralStringResourceIsOk() {
        lint().files(
            *stubs,
            kotlin(
                """
                package com.example
                import androidx.compose.material3.Text
                import androidx.compose.runtime.Composable
                import androidx.compose.ui.res.pluralStringResource
                @Composable fun Screen(n: Int) { Text(pluralStringResource(R.plurals.p, n, n)) }
                """,
            ).indented(),
        ).run().expectClean()
    }
}
