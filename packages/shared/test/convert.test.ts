// F-303 convertWithRates. TP-1.6, plus the extra cases TP-1.19x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { convertWithRates } from "../src/money/convert.js";
import { asCurrencyCode } from "../src/money/currency.js";
import { Money } from "../src/money/money.js";
import { parseDecimal, rational } from "../src/money/rational.js";
import { loadVectors } from "./support/vectors.js";

const EGP = asCurrencyCode("EGP");
const USD = asCurrencyCode("USD");
const EGP_RATE = { unitsPerUsd: parseDecimal("48.5"), minorUnits: 2 };
const USD_TARGET = { currency: USD, unitsPerUsd: rational(1n, 1n), minorUnits: 2 };

describe("F-303 convertWithRates", () => {
  it.each(
    loadVectors("convert").map((c) => [`${c.minor} ${c.from.currency} → ${c.to.currency}`, c]),
  )("TP-1.6: %s matches the vector", (_label, c) => {
    const result = convertWithRates(
      Money.of(BigInt(c.minor), asCurrencyCode(c.from.currency)),
      { unitsPerUsd: parseDecimal(c.from.unitsPerUsd), minorUnits: c.from.minorUnits },
      {
        currency: asCurrencyCode(c.to.currency),
        unitsPerUsd: parseDecimal(c.to.unitsPerUsd),
        minorUnits: c.to.minorUnits,
      },
    );

    expect(result.minor).toBe(BigInt(c.expected));
    expect(result.currency).toBe(c.to.currency);
  });

  it("TP-1.6: a same-currency conversion returns the same instance", () => {
    const m = Money.of(12345n, EGP);

    expect(
      convertWithRates(m, EGP_RATE, {
        currency: EGP,
        ...EGP_RATE,
        unitsPerUsd: parseDecimal("50"),
      }),
    ).toBe(m);
  });

  it.each([
    ["from", -1],
    ["from", 1.5],
    ["from", 5],
    ["to", -1],
    ["from", Number.NaN],
    ["to", 5],
  ])(
    'TP-1.6 (A-46): the EGP→JPY vector with %s.minorUnits %d throws RangeError("Invalid minor units")',
    (side, minorUnits) => {
      const from = {
        unitsPerUsd: parseDecimal("48.5"),
        minorUnits: side === "from" ? minorUnits : 2,
      };
      const to = {
        currency: asCurrencyCode("JPY"),
        unitsPerUsd: parseDecimal("149.25"),
        minorUnits: side === "to" ? minorUnits : 0,
      };

      expect(() => convertWithRates(Money.of(12345n, EGP), from, to)).toThrow(
        new RangeError("Invalid minor units"),
      );
    },
  );

  it("TP-1.6: a target unitsPerUsd of 0 throws RangeError", () => {
    expect(() =>
      convertWithRates(Money.of(100n, EGP), EGP_RATE, {
        ...USD_TARGET,
        unitsPerUsd: rational(0n, 1n),
      }),
    ).toThrow(RangeError);
  });

  it.each([
    ["source 0", rational(0n, 1n), rational(1n, 1n)],
    ["source negative", rational(-1n, 2n), rational(1n, 1n)],
    ["target negative", rational(97n, 2n), rational(-1n, 1n)],
  ])("TP-1.19x: a non-positive unitsPerUsd (%s) throws RangeError", (_label, from, to) => {
    expect(() =>
      convertWithRates(
        Money.of(100n, EGP),
        { unitsPerUsd: from, minorUnits: 2 },
        { ...USD_TARGET, unitsPerUsd: to },
      ),
    ).toThrow(RangeError);
  });

  // A-44: the target rate is normalised like the source rate (TP-1.16 covers the source side).
  it('TP-1.19x: a hand-built target rate { num: 1n, den: 0n } throws RangeError("Zero denominator")', () => {
    expect(() =>
      convertWithRates(Money.of(100n, EGP), EGP_RATE, {
        ...USD_TARGET,
        unitsPerUsd: { num: 1n, den: 0n },
      }),
    ).toThrow(new RangeError("Zero denominator"));
  });

  it("TP-1.19x: a hand-built target rate { num: 1n, den: -1n } is -1, a non-positive rate: RangeError", () => {
    expect(() =>
      convertWithRates(Money.of(100n, EGP), EGP_RATE, {
        ...USD_TARGET,
        unitsPerUsd: { num: 1n, den: -1n },
      }),
    ).toThrow(RangeError);
  });

  it("TP-1.19x: a hand-built target rate { num: -14925n, den: -100n } equals 149.25", () => {
    const result = convertWithRates(Money.of(12345n, EGP), EGP_RATE, {
      currency: asCurrencyCode("JPY"),
      unitsPerUsd: { num: -14925n, den: -100n },
      minorUnits: 0,
    });

    expect(result.minor).toBe(380n);
  });
});
