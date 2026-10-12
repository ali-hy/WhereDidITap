// F-304 wire conversion (A-36). TP-1.7, plus the extra cases TP-1.20x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { asCurrencyCode } from "../src/money/currency.js";
import { Money } from "../src/money/money.js";
import {
  fromWireMoney,
  MAX_WIRE_MINOR,
  MoneyRangeError,
  toMoney,
  toWire,
  toWireMoney,
} from "../src/money/wire.js";
import { loadVectors } from "./support/vectors.js";

const EGP = asCurrencyCode("EGP");

function caught(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("F-304 wire conversion", () => {
  it.each(loadVectors("wire").map((c) => [c.minor, c]))(
    "TP-1.7: toWire and toWireMoney of %s match the vector",
    (_label, c) => {
      const m = Money.of(BigInt(c.minor), EGP);

      if (c.expected === "MoneyRangeError") {
        expect(() => toWire(m)).toThrow(MoneyRangeError);
        expect(() => toWireMoney(m)).toThrow(MoneyRangeError);
      } else {
        expect(toWire(m)).toBe(Number(c.expected));
        expect(toWireMoney(m)).toEqual({ amount: Number(c.expected), currency: "EGP" });
      }
    },
  );

  it.each([[2 ** 53 - 1], [-(2 ** 53 - 1)], [0], [-12345]])(
    "TP-1.7: toMoney(%d, EGP) is exact",
    (minor) => {
      const m = toMoney(minor, EGP);

      expect(m.minor).toBe(BigInt(minor));
      expect(m.currency).toBe("EGP");
    },
  );

  it.each([[1.5], [2 ** 53], [-(2 ** 53)], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "TP-1.7: toMoney(%d, EGP) throws MoneyRangeError",
    (minor) => {
      expect(() => toMoney(minor, EGP)).toThrow(MoneyRangeError);
    },
  );

  it.each([
    ["2 ** 53", 2 ** 53, "9007199254740992"],
    ["-(2 ** 53)", -(2 ** 53), "9007199254740992"],
    ["1.5", 1.5, "1.5"],
    ["NaN", Number.NaN, "NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
    ['"5" (cast)', "5" as unknown as number, "5"],
  ])(
    "TP-1.7: fromWireMoney with amount %s throws MoneyRangeError without the amount in its message",
    (_label, amount, digits) => {
      const error = caught(() => fromWireMoney({ amount, currency: "EGP" }));

      expect(error).toBeInstanceOf(MoneyRangeError);
      expect((error as Error).message).not.toContain(digits);
    },
  );

  it("TP-1.7: fromWireMoney checks the amount before the currency code", () => {
    expect(() => fromWireMoney({ amount: 1.5, currency: "bad" })).toThrow(MoneyRangeError);
  });

  it("TP-1.7: fromWireMoney with a valid amount and an invalid code throws TypeError", () => {
    expect(() => fromWireMoney({ amount: 5, currency: "bad" })).toThrow(TypeError);
  });

  it("TP-1.20x: MAX_WIRE_MINOR is 2^53 − 1", () => {
    expect(MAX_WIRE_MINOR).toBe(9007199254740991);
  });

  it("TP-1.20x: MoneyRangeError's message holds no amount", () => {
    const error = caught(() => toWire(Money.of(98765432109876543n, EGP)));

    expect(error).toBeInstanceOf(MoneyRangeError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("98765432109876543");
  });

  it("TP-1.20x: fromWireMoney is the inverse of toWireMoney", () => {
    const m = fromWireMoney({ amount: -9007199254740991, currency: "KWD" });

    expect(m.minor).toBe(-9007199254740991n);
    expect(m.currency).toBe("KWD");
    expect(toWireMoney(m)).toEqual({ amount: -9007199254740991, currency: "KWD" });
  });

  it.each([["egp"], ["EG"], [""]])(
    "TP-1.20x: fromWireMoney with the invalid code %j throws TypeError",
    (currency) => {
      expect(() => fromWireMoney({ amount: 1, currency })).toThrow(TypeError);
    },
  );
});
