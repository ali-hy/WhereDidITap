// F-302 allocate. TP-1.5, plus the extra cases TP-1.18x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { allocate } from "../src/money/allocate.js";
import { asCurrencyCode } from "../src/money/currency.js";
import { Money } from "../src/money/money.js";
import { loadVectors } from "./support/vectors.js";

const EGP = asCurrencyCode("EGP");

describe("F-302 allocate", () => {
  it.each(loadVectors("allocate").map((c) => [`${c.minor} by [${c.weights.join(",")}]`, c]))(
    "TP-1.5: allocate(%s) matches the vector and its parts sum to the input",
    (_label, c) => {
      const m = Money.of(BigInt(c.minor), asCurrencyCode(c.currency));

      const parts = allocate(
        m,
        c.weights.map((w) => BigInt(w)),
      );

      expect(parts.map((p) => p.minor)).toEqual(c.expected.map((e) => BigInt(e)));
      expect(parts.every((p) => p.currency === c.currency)).toBe(true);
      expect(parts.reduce((total, p) => total + p.minor, 0n)).toBe(m.minor);
    },
  );

  it.each([
    ["[]", []],
    ["[-1n]", [-1n]],
    ["[0n, 0n]", [0n, 0n]],
  ])("TP-1.5: weights %s throw RangeError", (_label, weights) => {
    expect(() => allocate(Money.of(100n, EGP), weights)).toThrow(RangeError);
  });

  it.each([
    ["[1 (number), 1n]", [1 as unknown as bigint, 1n]],
    ['["1"]', ["1" as unknown as bigint]],
  ])('TP-1.5 (A-46): weights %s throw TypeError("Weights must be bigints")', (_label, weights) => {
    expect(() => allocate(Money.of(100n, EGP), weights)).toThrow(
      new TypeError("Weights must be bigints"),
    );
  });

  it("TP-1.18x: the bigint check runs before the RangeError checks (A-46)", () => {
    expect(() => allocate(Money.of(100n, EGP), [-1n, 1 as unknown as bigint])).toThrow(
      new TypeError("Weights must be bigints"),
    );
  });

  it("TP-1.18x: a negative weight next to positive ones throws RangeError", () => {
    expect(() => allocate(Money.of(100n, EGP), [2n, -1n])).toThrow(RangeError);
  });

  it("TP-1.18x: parts always sum to the input over a range of amounts and weights", () => {
    const weightSets = [[1n], [1n, 1n], [1n, 2n, 3n], [0n, 5n, 7n], [3n, 3n, 3n, 1n], [999n, 1n]];
    for (let minor = -50n; minor <= 50n; minor += 1n) {
      for (const weights of weightSets) {
        const parts = allocate(Money.of(minor, EGP), weights);

        expect(parts).toHaveLength(weights.length);
        expect(parts.reduce((total, p) => total + p.minor, 0n)).toBe(minor);
      }
    }
  });
});
