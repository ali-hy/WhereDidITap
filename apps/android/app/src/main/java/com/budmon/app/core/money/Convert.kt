// F-303 mirror: convert through USD rates, rounding half-even once at the end.
package com.budmon.app.core.money

import java.math.BigInteger

data class RateSide(val currency: String, val unitsPerUsd: Rational, val minorUnits: Int)

fun convertWithRates(m: Money, from: RateSide, to: RateSide): Money {
    if (m.currency == to.currency) return m
    if (listOf(from.minorUnits, to.minorUnits).any { it !in 0..4 }) throw ArithmeticException("Invalid minor units")
    val fromRate = Rational(from.unitsPerUsd.num, from.unitsPerUsd.den)
    val toRate = Rational(to.unitsPerUsd.num, to.unitsPerUsd.den)
    if (fromRate.num.signum() <= 0 || toRate.num.signum() <= 0) throw ArithmeticException("Rates must be positive")
    val fromScale = BigInteger.TEN.pow(from.minorUnits)
    val toScale = BigInteger.TEN.pow(to.minorUnits)
    val converted =
        Rational(
            m.minor
                .multiply(toRate.num)
                .multiply(fromRate.den)
                .multiply(toScale),
            toRate.den.multiply(fromRate.num).multiply(fromScale),
        )
    return Money.of(roundHalfEven(converted), to.currency)
}
