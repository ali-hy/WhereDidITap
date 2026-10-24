// TP-1.16: hand-built Rational values (A-44). Every function that takes a Rational normalises it
// through `rational(num, den)` first: a zero denominator throws RangeError("Zero denominator"), a
// negative one is normalised to an equal value, and the result is then judged as a value.
import { describe, expect, it } from "vitest";
import { convertWithRates } from "../src/money/convert.js";
import { asCurrencyCode } from "../src/money/currency.js";
import { Money, multiplyByRational } from "../src/money/money.js";
import { parseDecimal, toFixedDecimalString } from "../src/money/rational.js";
import { loadVectors } from "./support/vectors.js";

const EGP = asCurrencyCode("EGP");
const ZERO_DENOMINATOR = new RangeError("Zero denominator");

/** The EGP→JPY vector (TP-1.10's minimum set): 12345 EGP at 48.5 → 380 JPY at 149.25. */
function egpToJpyVector(): { minor: bigint; jpyRate: string; expected: bigint } {
  const c = loadVectors("convert").find(
    (v) => v.minor === "12345" && v.from.currency === "EGP" && v.to.currency === "JPY",
  );
  if (c === undefined) throw new Error("convert.json has no 12345 EGP→JPY case");
  return { minor: BigInt(c.minor), jpyRate: c.to.unitsPerUsd, expected: BigInt(c.expected) };
}

function convertEgpToJpy(fromRate: { num: bigint; den: bigint }): Money {
  const vector = egpToJpyVector();
  return convertWithRates(
    Money.of(vector.minor, EGP),
    { unitsPerUsd: fromRate, minorUnits: 2 },
    { currency: asCurrencyCode("JPY"), unitsPerUsd: parseDecimal(vector.jpyRate), minorUnits: 0 },
  );
}

describe("TP-1.16: hand-built Rationals (A-44)", () => {
  const m = Money.of(12345n, EGP);

  it('TP-1.16: toFixedDecimalString({ num: 1n, den: -4n }, 2) is "-0.25"', () => {
    expect(toFixedDecimalString({ num: 1n, den: -4n }, 2)).toBe("-0.25");
  });

  it('TP-1.16: toFixedDecimalString({ num: 1n, den: 0n }, 2) throws RangeError("Zero denominator")', () => {
    expect(() => toFixedDecimalString({ num: 1n, den: 0n }, 2)).toThrow(ZERO_DENOMINATOR);
  });

  it('TP-1.16: multiplyByRational(m, { num: 1n, den: 0n }) throws RangeError("Zero denominator")', () => {
    expect(() => multiplyByRational(m, { num: 1n, den: 0n })).toThrow(ZERO_DENOMINATOR);
  });

  it("TP-1.16: multiplyByRational(m, { num: -1n, den: -2n }) is 6172n EGP (½, half-even)", () => {
    const result = multiplyByRational(m, { num: -1n, den: -2n });

    expect(result.minor).toBe(6172n);
    expect(result.currency).toBe("EGP");
  });

  it("TP-1.16: convertWithRates with from.unitsPerUsd { num: -485n, den: -10n } gives the vector's 380n JPY", () => {
    const result = convertEgpToJpy({ num: -485n, den: -10n });

    expect(result.minor).toBe(egpToJpyVector().expected);
    expect(result.minor).toBe(380n);
    expect(result.currency).toBe("JPY");
  });

  it('TP-1.16: convertWithRates with from.unitsPerUsd { num: 1n, den: 0n } throws RangeError("Zero denominator")', () => {
    expect(() => convertEgpToJpy({ num: 1n, den: 0n })).toThrow(ZERO_DENOMINATOR);
  });

  it("TP-1.16: convertWithRates with from.unitsPerUsd { num: 1n, den: -1n } throws RangeError (a non-positive rate)", () => {
    expect(() => convertEgpToJpy({ num: 1n, den: -1n })).toThrow(RangeError);
  });
});
