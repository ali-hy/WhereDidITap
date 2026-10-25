// F-301 mirror: exact rationals, normalised with a positive denominator.
package com.budmon.app.core.money

import java.math.BigInteger

class Rational(num: BigInteger, den: BigInteger) {
    val num: BigInteger
    val den: BigInteger

    init {
        if (den.signum() == 0) throw ArithmeticException("Zero denominator")
        val divisor = num.gcd(den).let { if (it.signum() == 0) BigInteger.ONE else it }
        val sign = if (den.signum() < 0) BigInteger.ONE.negate() else BigInteger.ONE
        this.num = num.multiply(sign).divide(divisor)
        this.den = den.multiply(sign).divide(divisor)
    }

    override fun equals(other: Any?): Boolean = other is Rational && other.num == num && other.den == den

    override fun hashCode(): Int = num.hashCode() * 31 + den.hashCode()

    override fun toString(): String = "Rational($num/$den)"

    operator fun component1(): BigInteger = num

    operator fun component2(): BigInteger = den
}

private val DECIMAL = Regex("""^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$""")

fun parseDecimal(text: String): Rational {
    val match = DECIMAL.matchEntire(text) ?: throw ArithmeticException("Invalid decimal")
    val (sign, whole, fraction, exponent) = match.destructured
    val digits = BigInteger("$sign$whole$fraction")
    val scale = fraction.length - (if (exponent.isEmpty()) 0 else exponent.toInt())
    return if (scale > 0) {
        Rational(digits, BigInteger.TEN.pow(scale))
    } else {
        Rational(digits.multiply(BigInteger.TEN.pow(-scale)), BigInteger.ONE)
    }
}

fun roundHalfEven(r: Rational): BigInteger {
    val value = Rational(r.num, r.den)
    val negative = value.num.signum() < 0
    val abs = value.num.abs()
    var quotient = abs.divide(value.den)
    val twiceRemainder = abs.mod(value.den).shiftLeft(1)
    val cmp = twiceRemainder.compareTo(value.den)
    if (cmp > 0 || (cmp == 0 && quotient.testBit(0))) quotient = quotient.add(BigInteger.ONE)
    return if (negative) quotient.negate() else quotient
}

fun toFixedDecimalString(r: Rational, scale: Int): String {
    if (scale !in 0..18) throw ArithmeticException("Invalid scale")
    val scaled = roundHalfEven(Rational(r.num.multiply(BigInteger.TEN.pow(scale)), r.den))
    val sign = if (scaled.signum() < 0) "-" else ""
    val digits = scaled.abs().toString().padStart(scale + 1, '0')
    val point = digits.length - scale
    return if (scale == 0) "$sign$digits" else "$sign${digits.substring(0, point)}.${digits.substring(point)}"
}
