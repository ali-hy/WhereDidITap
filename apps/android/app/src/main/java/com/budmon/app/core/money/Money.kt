// F-256 (A-345): Kotlin mirrors of the shared money functions (F-300 to F-305). Amounts are
// BigInteger minor units; no floating point anywhere.
package com.budmon.app.core.money

import java.math.BigInteger

private val CURRENCY = Regex("^[A-Z]{3}$")

class Money private constructor(val minor: BigInteger, val currency: String) {
    override fun equals(other: Any?): Boolean = other is Money && other.minor == minor && other.currency == currency

    override fun hashCode(): Int = minor.hashCode() * 31 + currency.hashCode()

    /** Amounts never reach logs or crash reports. */
    override fun toString(): String = "[redacted]"

    companion object {
        fun of(minor: BigInteger, currency: String): Money {
            require(CURRENCY.matches(currency)) { "Invalid currency code" }
            return Money(minor, currency)
        }
    }
}

class CurrencyMismatchException(message: String) : IllegalArgumentException(message)

/** An amount outside ±MAX_WIRE_MINOR; the message never carries the amount. */
class MoneyRangeError : ArithmeticException("Amount is outside the safe integer range")
