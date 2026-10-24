// F-302 mirror: split an amount by weights, largest remainders first, never losing a minor unit.
package com.budmon.app.core.money

import java.math.BigInteger

fun allocate(m: Money, weights: List<BigInteger>): List<Money> {
    if (weights.isEmpty() || weights.any { it.signum() < 0 }) throw ArithmeticException("Invalid allocation weights")
    val total = weights.fold(BigInteger.ZERO, BigInteger::add)
    if (total.signum() == 0) throw ArithmeticException("Allocation weights sum to zero")
    val negative = m.minor.signum() < 0
    val abs = m.minor.abs()
    val count = BigInteger.valueOf(weights.size.toLong())
    val shares = weights.map { abs.multiply(it).divide(total) }
    val leftover = abs.subtract(shares.fold(BigInteger.ZERO, BigInteger::add))
    val order =
        weights
            .mapIndexed { index, w ->
                index to
                    abs
                        .multiply(
                            w,
                        ).mod(total)
                        .multiply(count)
                        .add(count.subtract(BigInteger.ONE).subtract(BigInteger.valueOf(index.toLong())))
            }.sortedByDescending { it.second }
    val bumped = order.filterIndexed { rank, _ -> BigInteger.valueOf(rank.toLong()) < leftover }.map { it.first }.toSet()
    return shares.mapIndexed { index, share ->
        val part = if (index in bumped) share.add(BigInteger.ONE) else share
        Money.of(if (negative) part.negate() else part, m.currency)
    }
}
