// F-156 / F-209: the client rules and the normal form of a second-factor code.
package com.budmon.app.identity

internal object TwoStepInput {
    private const val CODE_LENGTH = 6
    private const val RECOVERY_LENGTH = 12

    /** A one-time code with all whitespace removed. */
    fun code(value: String): String = value.filterNot { it.isWhitespace() }

    fun isCode(normal: String): Boolean = normal.length == CODE_LENGTH && normal.all { it in '0'..'9' }

    /** A recovery code upper-cased, with dashes and whitespace removed. */
    fun recovery(value: String): String = value.filterNot { it.isWhitespace() || it == '-' }.uppercase()

    fun isRecovery(normal: String): Boolean = normal.length == RECOVERY_LENGTH && normal.all { it in 'A'..'Z' || it in '2'..'7' }
}
