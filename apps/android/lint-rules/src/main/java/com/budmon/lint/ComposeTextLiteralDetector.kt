// F-261: user-visible Compose text comes from resources, never string literals or templates.
package com.budmon.lint

import com.android.tools.lint.detector.api.Category
import com.android.tools.lint.detector.api.Detector
import com.android.tools.lint.detector.api.Implementation
import com.android.tools.lint.detector.api.Issue
import com.android.tools.lint.detector.api.JavaContext
import com.android.tools.lint.detector.api.Scope
import com.android.tools.lint.detector.api.Severity
import com.android.tools.lint.detector.api.SourceCodeScanner
import com.intellij.psi.PsiMethod
import org.jetbrains.uast.UBinaryExpression
import org.jetbrains.uast.UCallExpression
import org.jetbrains.uast.UElement
import org.jetbrains.uast.UExpression
import org.jetbrains.uast.ULambdaExpression
import org.jetbrains.uast.ULiteralExpression
import org.jetbrains.uast.UParenthesizedExpression
import org.jetbrains.uast.UPolyadicExpression
import org.jetbrains.uast.UQualifiedReferenceExpression
import org.jetbrains.uast.USimpleNameReferenceExpression
import org.jetbrains.uast.getParentOfType
import org.jetbrains.uast.skipParenthesizedExprDown

class ComposeTextLiteralDetector :
    Detector(),
    SourceCodeScanner {
    override fun getApplicableUastTypes(): List<Class<out UElement>> = listOf(UCallExpression::class.java, UBinaryExpression::class.java)

    override fun createUastHandler(context: JavaContext) = object : com.android.tools.lint.client.api.UElementHandler() {
        override fun visitCallExpression(node: UCallExpression) {
            val method = node.resolve() ?: return
            checkTextArgument(context, node, method)
            checkContentDescriptionArgument(context, node, method)
        }

        /** `contentDescription = "…"` inside `Modifier.semantics { }`. */
        override fun visitBinaryExpression(node: UBinaryExpression) {
            val left = node.leftOperand
            val name =
                when (left) {
                    is USimpleNameReferenceExpression -> left.identifier
                    is UQualifiedReferenceExpression -> (left.selector as? USimpleNameReferenceExpression)?.identifier
                    else -> null
                }
            if (name != "contentDescription" || node.operatorIdentifier?.name != "=") return
            val lambda = node.getParentOfType<ULambdaExpression>() ?: return
            val call = lambda.getParentOfType<UCallExpression>() ?: return
            if (call.methodName != "semantics" && call.methodName != "clearAndSetSemantics") return
            if (isLiteral(node.rightOperand)) report(context, node.rightOperand)
        }
    }

    private fun checkTextArgument(context: JavaContext, node: UCallExpression, method: PsiMethod) {
        val owner = method.containingClass?.qualifiedName ?: return
        val isText =
            (method.name == "Text" && owner.startsWith("androidx.compose.material3.")) ||
                (method.name == "BasicText" && owner.startsWith("androidx.compose.foundation.text."))
        if (!isText) return
        argumentFor(context, node, method, "text")?.let { if (isLiteral(it)) report(context, it) }
    }

    private fun checkContentDescriptionArgument(context: JavaContext, node: UCallExpression, method: PsiMethod) {
        argumentFor(context, node, method, "contentDescription")?.let { if (isLiteral(it)) report(context, it) }
    }

    private fun argumentFor(context: JavaContext, node: UCallExpression, method: PsiMethod, name: String): UExpression? {
        val mapping = context.evaluator.computeArgumentMapping(node, method)
        return mapping.entries.firstOrNull { it.value.name == name }?.key
    }

    /** A string literal or a string template (a template is a polyadic of literals and values). */
    private fun isLiteral(expression: UExpression): Boolean {
        val e = expression.skipParenthesizedExprDown()
        return when (e) {
            is ULiteralExpression -> e.value is String
            is UPolyadicExpression -> e.operands.any { (it.skipParenthesizedExprDown() as? ULiteralExpression)?.value is String }
            is UParenthesizedExpression -> isLiteral(e.expression)
            else -> false
        }
    }

    private fun report(context: JavaContext, expression: UExpression) {
        context.report(
            ISSUE,
            expression,
            context.getLocation(expression),
            "Compose text must come from a string resource (stringResource or pluralStringResource), not a literal",
        )
    }

    companion object {
        @JvmField
        val ISSUE: Issue =
            Issue.create(
                id = "BudmonHardcodedComposeText",
                briefDescription = "Hard-coded text in Compose",
                explanation = "User-visible text and content descriptions come from string resources, so they can be translated.",
                category = Category.I18N,
                priority = 8,
                severity = Severity.ERROR,
                implementation = Implementation(ComposeTextLiteralDetector::class.java, Scope.JAVA_FILE_SCOPE),
            )
    }
}
