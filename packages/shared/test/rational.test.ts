// F-300 currency codes and rationals. TP-1.1, TP-1.2, plus the extra cases TP-1.16x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { asCurrencyCode } from "../src/money/currency.js";
import {
  parseDecimal,
  rational,
  roundHalfEven,
  toFixedDecimalString,
} from "../src/money/rational.js";
import { loadVectors } from "./support/vectors.js";

describe("F-300 parseDecimal", () => {
  it.each([
    ["0.1", 1n, 10n],
    ["-12.50", -25n, 2n],
    ["1.5e-3", 3n, 2000n],
    ["1e3", 1000n, 1n],
  ])("TP-1.1: parseDecimal(%j) is the exact rational", (text, num, den) => {
    expect(parseDecimal(text)).toEqual({ num, den });
  });

  it.each([[""], ["1."], ["abc"], ["1e9999"]])(
    'TP-1.1: parseDecimal(%j) throws RangeError("Invalid decimal")',
    (text) => {
      expect(() => parseDecimal(text)).toThrow(new RangeError("Invalid decimal"));
    },
  );

  it.each([
    ["+7", 7n, 1n],
    ["0", 0n, 1n],
    ["-0.000", 0n, 1n],
    ["1E+2", 100n, 1n],
    ["12.5e-1", 5n, 4n],
    ["1e999", 10n ** 999n, 1n],
  ])("TP-1.16x: parseDecimal(%j) accepts the allowed forms", (text, num, den) => {
    expect(parseDecimal(text)).toEqual({ num, den });
  });

  it.each([[".5"], ["1.2.3"], [" 1"], ["1 "], ["1e"], ["0x10"], ["1_000"], ["Infinity"], ["--1"]])(
    "TP-1.16x: parseDecimal(%j) is outside the grammar and throws RangeError",
    (text) => {
      expect(() => parseDecimal(text)).toThrow(new RangeError("Invalid decimal"));
    },
  );
});

describe("F-300 roundHalfEven", () => {
  it.each(loadVectors("rounding").map((c) => [`${c.num}/${c.den}`, c]))(
    "TP-1.2: roundHalfEven(%s) matches the vector",
    (_label, c) => {
      expect(roundHalfEven(rational(BigInt(c.num), BigInt(c.den)))).toBe(BigInt(c.expected));
    },
  );

  it.each([
    [5n, 2n, 2n],
    [7n, 2n, 4n],
    [-5n, 2n, -2n],
  ])("TP-1.16x: F-300's examples: roundHalfEven(%i/%i) is %i", (num, den, expected) => {
    expect(roundHalfEven(rational(num, den))).toBe(expected);
  });
});

describe("F-300 roundHalfEven with a hand-built Rational (A-44)", () => {
  it("TP-1.2 (A-44): roundHalfEven({ num: 5n, den: -2n }) is -2n, the value of -5/2", () => {
    expect(roundHalfEven({ num: 5n, den: -2n })).toBe(-2n);
  });

  it('TP-1.2 (A-44): roundHalfEven({ num: 1n, den: 0n }) throws RangeError("Zero denominator")', () => {
    expect(() => roundHalfEven({ num: 1n, den: 0n })).toThrow(new RangeError("Zero denominator"));
  });
});

describe("F-300 rational", () => {
  it.each([
    [2n, 4n, 1n, 2n],
    [2n, -4n, -1n, 2n],
    [-3n, -9n, 1n, 3n],
    [0n, -5n, 0n, 1n],
  ])("TP-1.16x: rational(%i, %i) normalises to %i/%i", (num, den, n, d) => {
    expect(rational(num, den)).toEqual({ num: n, den: d });
  });

  it('TP-1.16x: rational with a zero denominator throws RangeError("Zero denominator")', () => {
    expect(() => rational(1n, 0n)).toThrow(new RangeError("Zero denominator"));
  });
});

describe("F-300 toFixedDecimalString", () => {
  it.each([
    [1n, 3n, 2, "0.33"],
    [2n, 3n, 2, "0.67"],
    [5n, 2n, 0, "2"],
    [7n, 2n, 0, "4"],
    [1n, 8n, 2, "0.12"],
    [3n, 8n, 2, "0.38"],
    [-1234567n, 1000n, 2, "-1234.57"],
    [123n, 1n, 3, "123.000"],
    [1n, 10n ** 18n, 18, "0.000000000000000001"],
    [10n ** 30n, 1n, 0, "1000000000000000000000000000000"],
  ])("TP-1.16x: toFixedDecimalString(%i/%i, %i) is %j", (num, den, scale, expected) => {
    expect(toFixedDecimalString(rational(num, den), scale)).toBe(expected);
  });

  it.each([[-1], [19], [1.5], [Number.NaN]])(
    "TP-1.16x: a scale of %d throws RangeError",
    (scale) => {
      expect(() => toFixedDecimalString(rational(1n, 2n), scale)).toThrow(RangeError);
    },
  );
});

describe("F-300 asCurrencyCode", () => {
  it("TP-1.16x: a three-letter upper-case code is returned unchanged", () => {
    expect(asCurrencyCode("EGP")).toBe("EGP");
  });

  it.each([["egp"], ["EG"], ["EGPX"], [""], ["E1P"], [" EGP"]])(
    'TP-1.16x: asCurrencyCode(%j) throws TypeError("Invalid currency code")',
    (code) => {
      expect(() => asCurrencyCode(code)).toThrow(new TypeError("Invalid currency code"));
    },
  );
});
