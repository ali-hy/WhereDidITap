// F-305 mirror: a localised amount with the currency code, exactly minorUnits fraction digits.
package com.budmon.app.core.money

import android.icu.text.NumberFormat
import android.icu.util.Currency
import android.icu.util.ULocale
import java.math.BigDecimal
import java.math.BigInteger
import java.util.Locale

fun formatMoney(m: Money, locale: Locale, minorUnits: Int): String {
    if (minorUnits !in 0..4) throw ArithmeticException("minorUnits must be an integer from 0 to 4")
    val decimal = BigDecimal(toFixedDecimalString(Rational(m.minor, BigInteger.TEN.pow(minorUnits)), minorUnits))
    val format = NumberFormat.getInstance(ULocale.forLocale(locale), NumberFormat.ISOCURRENCYSTYLE)
    format.currency = Currency.getInstance(m.currency)
    format.minimumFractionDigits = minorUnits
    format.maximumFractionDigits = minorUnits
    return format.format(decimal)
}
