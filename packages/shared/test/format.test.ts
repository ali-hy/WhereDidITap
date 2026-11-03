// F-305 formatMoney. TP-1.8, plus the extra cases TP-1.21x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { asCurrencyCode } from "../src/money/currency.js";
import { formatMoney } from "../src/money/format.js";
import { Money } from "../src/money/money.js";
import { loadVectors, normaliseSpaces } from "./support/vectors.js";

const EGP = asCurrencyCode("EGP");
const USD = asCurrencyCode("USD");

describe("F-305 formatMoney", () => {
  it.each(loadVectors("format").map((c) => [`${c.minor} ${c.currency} in ${c.locale}`, c]))(
    "TP-1.8: %s matches the vector (spaces normalised)",
    (_label, c) => {
      const text = formatMoney(Money.of(BigInt(c.minor), asCurrencyCode(c.currency)), {
        locale: c.locale,
        minorUnits: c.minorUnits,
      });

      expect(normaliseSpaces(text)).toBe(normaliseSpaces(c.expected));
    },
  );

  it.each([[5], [-1], [1.5]])("TP-1.8: minorUnits %d throws RangeError", (minorUnits) => {
    expect(() => formatMoney(Money.of(1n, EGP), { locale: "en-US", minorUnits })).toThrow(
      RangeError,
    );
  });

  it("TP-1.21x: minorUnits 4 is allowed", () => {
    expect(
      normaliseSpaces(formatMoney(Money.of(12345n, EGP), { locale: "en-US", minorUnits: 4 })),
    ).toBe("EGP 1.2345");
  });

  it("TP-1.21x: amounts beyond 2^53 are formatted exactly", () => {
    const text = formatMoney(Money.of(123456789012345678901n, EGP), {
      locale: "en-US",
      minorUnits: 2,
    });

    expect(normaliseSpaces(text)).toBe("EGP 1,234,567,890,123,456,789.01");
  });

  it("TP-1.21x: currencyDisplay and signDisplay are passed to Intl", () => {
    expect(
      normaliseSpaces(
        formatMoney(Money.of(123450n, USD), {
          locale: "en-US",
          minorUnits: 2,
          currencyDisplay: "symbol",
          signDisplay: "always",
        }),
      ),
    ).toBe("+$1,234.50");
  });
});
