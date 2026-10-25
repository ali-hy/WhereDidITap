// F-301: Money and arithmetic. Amounts never appear in strings, logs or JSON.
import { asCurrencyCode, type CurrencyCode } from "./currency.js";
import { rational, roundHalfEven, type Rational } from "./rational.js";

const REDACTED = "[redacted]";

export class Money {
  declare readonly minor: bigint;
  declare readonly currency: CurrencyCode;

  private constructor(minor: bigint, currency: CurrencyCode) {
    // Non-enumerable, so Object.keys, spread and JSON.stringify of a spread copy show nothing (A-47).
    Object.defineProperties(this, {
      minor: { value: minor, enumerable: false, writable: false },
      currency: { value: currency, enumerable: false, writable: false },
    });
    Object.freeze(this);
  }

  static of(minor: bigint, currency: CurrencyCode): Money {
    if (typeof minor !== "bigint") {
      throw new TypeError("Money amounts are bigint minor units");
    }
    return new Money(minor, asCurrencyCode(currency));
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

export class CurrencyMismatchError extends Error {
  override readonly name = "CurrencyMismatchError";
}

function assertSameCurrency(a: CurrencyCode, b: CurrencyCode): void {
  if (a !== b) {
    throw new CurrencyMismatchError(`Currency mismatch: ${a} and ${b}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a.currency, b.currency);
  return Money.of(a.minor + b.minor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a.currency, b.currency);
  return Money.of(a.minor - b.minor, a.currency);
}

export function negate(a: Money): Money {
  return Money.of(-a.minor, a.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  let total = 0n;
  for (const item of items) {
    assertSameCurrency(currency, item.currency);
    total += item.minor;
  }
  return Money.of(total, currency);
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a.currency, b.currency);
  if (a.minor < b.minor) return -1;
  return a.minor > b.minor ? 1 : 0;
}

export function isZero(a: Money): boolean {
  return a.minor === 0n;
}

export function multiplyByRational(m: Money, r: Rational): Money {
  return Money.of(roundHalfEven(rational(m.minor * r.num, r.den)), m.currency);
}

export function percentOf(m: Money, basisPoints: bigint): Money {
  return multiplyByRational(m, rational(basisPoints, 10000n));
}

export function ratio(part: Money, whole: Money): Rational {
  assertSameCurrency(part.currency, whole.currency);
  if (whole.minor === 0n) {
    throw new RangeError("Ratio of a zero amount");
  }
  return rational(part.minor, whole.minor);
}
