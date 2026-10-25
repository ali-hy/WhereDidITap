// F-303: currency conversion through USD rates, rounding once.
import type { CurrencyCode } from "./currency.js";
import { Money } from "./money.js";
import { rational, roundHalfEven, type Rational } from "./rational.js";

export function convertWithRates(
  m: Money,
  from: { unitsPerUsd: Rational; minorUnits: number },
  to: { currency: CurrencyCode; unitsPerUsd: Rational; minorUnits: number },
): Money {
  if (m.currency === to.currency) {
    return m;
  }
  if (
    [from.minorUnits, to.minorUnits].some(
      (units) => !Number.isInteger(units) || units < 0 || units > 4,
    )
  ) {
    throw new RangeError("Invalid minor units");
  }
  // Normalise hand-built rationals (negative or zero denominators) before using them as rates.
  const fromRate = rational(from.unitsPerUsd.num, from.unitsPerUsd.den);
  const toRate = rational(to.unitsPerUsd.num, to.unitsPerUsd.den);
  if (fromRate.num <= 0n || toRate.num <= 0n) {
    throw new RangeError("Rates must be positive");
  }
  const fromScale = 10n ** BigInt(from.minorUnits);
  const toScale = 10n ** BigInt(to.minorUnits);
  const converted = rational(
    m.minor * toRate.num * fromRate.den * toScale,
    toRate.den * fromRate.num * fromScale,
  );
  return Money.of(roundHalfEven(converted), to.currency);
}
