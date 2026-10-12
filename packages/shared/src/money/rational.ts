// F-300: exact rationals and half-even rounding.
export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export function rational(num: bigint, den: bigint): Rational {
  if (den === 0n) {
    throw new RangeError("Zero denominator");
  }
  const divisor = gcd(num, den);
  const sign = den < 0n ? -1n : 1n;
  return { num: (sign * num) / divisor, den: (sign * den) / divisor };
}

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/;

export function parseDecimal(text: string): Rational {
  const match = DECIMAL.exec(text);
  if (match === null) {
    throw new RangeError("Invalid decimal");
  }
  const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
  const digits = BigInt(`${sign}${whole}${fraction}`);
  const scale = BigInt(fraction.length) - BigInt(exponent);
  return scale > 0n ? rational(digits, 10n ** scale) : rational(digits * 10n ** -scale, 1n);
}

export function roundHalfEven(value: Rational): bigint {
  const { num, den } = rational(value.num, value.den);
  const negative = num < 0n;
  const abs = negative ? -num : num;
  let quotient = abs / den;
  const twiceRemainder = (abs % den) * 2n;
  if (twiceRemainder > den || (twiceRemainder === den && quotient % 2n === 1n)) {
    quotient += 1n;
  }
  return negative ? -quotient : quotient;
}

export function toFixedDecimalString(value: Rational, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new RangeError("Invalid scale");
  }
  const scaled = roundHalfEven(rational(value.num * 10n ** BigInt(scale), value.den));
  const sign = scaled < 0n ? "-" : "";
  const digits = (scaled < 0n ? -scaled : scaled).toString().padStart(scale + 1, "0");
  const point = digits.length - scale;
  return scale === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}
