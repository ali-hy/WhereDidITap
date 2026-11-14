// F-304 mirror: amounts on the wire are integers within ±(2^53 − 1).
package com.budmon.app.core.money

import java.math.BigInteger

const val MAX_WIRE_MINOR = 9_007_199_254_740_991L

private val MAX_WIRE = BigInteger.valueOf(MAX_WIRE_MINOR)

fun toWire(m: Money): Long {
    if (m.minor > MAX_WIRE || m.minor < MAX_WIRE.negate()) throw MoneyRangeError()
    return m.minor.toLong()
}

fun fromWire(amount: Long, currency: String): Money {
    if (amount > MAX_WIRE_MINOR || amount < -MAX_WIRE_MINOR) throw MoneyRangeError()
    return Money.of(BigInteger.valueOf(amount), currency)
}
