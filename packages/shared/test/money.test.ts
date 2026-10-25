// F-301 Money and arithmetic. TP-1.3, TP-1.4, plus the extra cases TP-1.17x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { asCurrencyCode, type CurrencyCode } from "../src/money/currency.js";
import {
  add,
  compare,
  CurrencyMismatchError,
  isZero,
  Money,
  multiplyByRational,
  negate,
  percentOf,
  ratio,
  subtract,
  sum,
} from "../src/money/money.js";
import { rational, type Rational } from "../src/money/rational.js";

const EGP = asCurrencyCode("EGP");
const USD = asCurrencyCode("USD");

function egp(minor: bigint): Money {
  return Money.of(minor, EGP);
}

function expectSameValue(actual: Rational, num: bigint, den: bigint): void {
  expect(actual.num * den).toBe(num * actual.den);
}

describe("F-301 redaction", () => {
  const m = Money.of(987654321n, EGP);

  it.each([
    ["String(m)", () => String(m)],
    ["JSON.stringify({ m })", () => JSON.stringify({ m })],
    ["util.inspect(m)", () => inspect(m)],
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- TP-1.3 interpolates Money on purpose
    ["template literal", () => `${m}`],
  ])("TP-1.3: %s contains [redacted] and not the amount", (_label, render) => {
    const text = render();

    expect(text).toContain("[redacted]");
    expect(text).not.toContain("987654321");
  });

  it("TP-1.17x: util.inspect of an object holding Money doesn't show the amount", () => {
    const text = inspect({ nested: { m } }, { depth: 5 });

    expect(text).toContain("[redacted]");
    expect(text).not.toContain("987654321");
  });
});

describe("F-301 opacity (A-47)", () => {
  const m = Money.of(987654321n, EGP);

  it("TP-1.3 (A-47): Object.keys(m) is []", () => {
    expect(Object.keys(m)).toEqual([]);
  });

  it('TP-1.3 (A-47): JSON.stringify({ ...m }) is "{}"', () => {
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- TP-1.3 spreads Money on purpose (A-47)
    expect(JSON.stringify({ ...m })).toBe("{}");
  });

  it("TP-1.3 (A-47): minor and currency are readable, non-enumerable and read-only own properties", () => {
    expect(m.minor).toBe(987654321n);
    expect(m.currency).toBe("EGP");
    for (const key of ["minor", "currency"]) {
      const descriptor = Object.getOwnPropertyDescriptor(m, key);
      expect(descriptor?.enumerable).toBe(false);
      expect(descriptor?.writable === true || descriptor?.set !== undefined).toBe(false);
    }
  });

  it.each([["egp"], ["EGPX"]])(
    'TP-1.3 (A-47): Money.of(1n, %j) throws TypeError("Invalid currency code")',
    (code) => {
      expect(() => Money.of(1n, code as CurrencyCode)).toThrow(
        new TypeError("Invalid currency code"),
      );
    },
  );
});

describe("F-301 currency mismatches", () => {
  const a = Money.of(987654321n, EGP);
  const b = Money.of(123456789n, USD);

  it.each([
    ["add", () => add(a, b)],
    ["subtract", () => subtract(a, b)],
    ["sum", () => sum([a, b], EGP)],
    ["compare", () => compare(a, b)],
    ["ratio", () => ratio(a, b)],
  ])(
    "TP-1.4: %s with EGP and USD throws CurrencyMismatchError naming only the two codes",
    (_label, operation) => {
      let caught: unknown;
      try {
        operation();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CurrencyMismatchError);
      const error = caught as Error;
      expect(error.name).toBe("CurrencyMismatchError");
      expect(error.message).toContain("EGP");
      expect(error.message).toContain("USD");
      expect(error.message).not.toMatch(/\d/);
    },
  );

  it("TP-1.17x: sum with items in another currency than the requested one throws", () => {
    expect(() => sum([Money.of(1n, USD)], EGP)).toThrow(CurrencyMismatchError);
  });
});

describe("F-301 sum and ratio", () => {
  it("TP-1.4: sum([], EGP) is zero EGP", () => {
    const total = sum([], EGP);

    expect(total.minor).toBe(0n);
    expect(total.currency).toBe("EGP");
  });

  it("TP-1.4: ratio with a zero whole throws RangeError", () => {
    expect(() => ratio(egp(5n), egp(0n))).toThrow(RangeError);
  });

  it("TP-1.17x: sum adds every item exactly", () => {
    expect(sum([egp(9007199254740993n), egp(7n), egp(-1n)], EGP).minor).toBe(9007199254740999n);
  });

  it.each([
    [25n, 100n, 1n, 4n],
    [-30n, 90n, -1n, 3n],
    [7n, -2n, -7n, 2n],
    [0n, 3n, 0n, 1n],
  ])("TP-1.17x: ratio(%i, %i) is exactly %i/%i", (part, whole, num, den) => {
    expectSameValue(ratio(egp(part), egp(whole)), num, den);
  });
});

describe("F-301 Money", () => {
  it("TP-1.17x: Money.of keeps the minor amount and the currency", () => {
    const m = Money.of(-12345n, EGP);

    expect(m.minor).toBe(-12345n);
    expect(m.currency).toBe("EGP");
  });

  it("TP-1.17x: instances are frozen", () => {
    expect(Object.isFrozen(egp(1n))).toBe(true);
  });

  it.each([[1], ["1"], [null], [undefined], [1.5]])(
    "TP-1.17x: Money.of with a non-bigint minor (%j) throws TypeError",
    (minor) => {
      expect(() => Money.of(minor as unknown as bigint, EGP)).toThrow(TypeError);
    },
  );

  it("TP-1.17x: toString and toJSON return [redacted]", () => {
    const m = egp(42n);

    expect(m.toString()).toBe("[redacted]");
    expect(m.toJSON()).toBe("[redacted]");
  });
});

describe("F-301 arithmetic", () => {
  it("TP-1.17x: add, subtract and negate are exact and keep the currency", () => {
    const big = egp(9007199254740993n);

    expect(add(big, egp(2n)).minor).toBe(9007199254740995n);
    expect(subtract(egp(5n), egp(8n)).minor).toBe(-3n);
    expect(negate(egp(5n)).minor).toBe(-5n);
    expect(add(big, egp(2n)).currency).toBe("EGP");
  });

  it.each([
    [1n, 2n, -1],
    [2n, 2n, 0],
    [3n, -2n, 1],
  ])("TP-1.17x: compare(%i, %i) is %i", (a, b, expected) => {
    expect(compare(egp(a), egp(b))).toBe(expected);
  });

  it("TP-1.17x: isZero", () => {
    expect(isZero(egp(0n))).toBe(true);
    expect(isZero(egp(1n))).toBe(false);
    expect(isZero(egp(-1n))).toBe(false);
  });

  it.each([
    [5n, 1n, 2n, 2n],
    [7n, 1n, 2n, 4n],
    [-5n, 1n, 2n, -2n],
    [10n, 1n, 3n, 3n],
    [10n, 2n, 3n, 7n],
    [9007199254740993n, 1n, 1n, 9007199254740993n],
  ])(
    "TP-1.17x: multiplyByRational(%i, %i/%i) rounds once, half-even, to %i",
    (minor, n, d, expected) => {
      const result = multiplyByRational(egp(minor), rational(n, d));

      expect(result.minor).toBe(expected);
      expect(result.currency).toBe("EGP");
    },
  );

  it.each([
    [10000n, 1250n, 1250n],
    [1n, 5000n, 0n],
    [3n, 5000n, 2n],
    [-3n, 5000n, -2n],
    [12345n, 0n, 0n],
    [12345n, 10000n, 12345n],
  ])("TP-1.17x: percentOf(%i, %i bp) is %i", (minor, basisPoints, expected) => {
    expect(percentOf(egp(minor), basisPoints).minor).toBe(expected);
  });
});
