// TP-1.10: the shared test vectors (F-313) hold at least the minimum set of cases, and the format
// vectors only CLDR-stable cases (A-37).
import { describe, expect, it } from "vitest";
import { loadVectors, type FormatCase } from "./support/vectors.js";

describe("TP-1.10: test vectors", () => {
  it("TP-1.10: rounding has at least 10 cases including ±1/2, ±3/2, ±5/2, 7/2, 1/3 and −1/3", () => {
    const cases = loadVectors("rounding");
    const keys = new Set(cases.map((c) => `${c.num}/${c.den}`));

    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const key of ["1/2", "-1/2", "3/2", "-3/2", "5/2", "-5/2", "7/2", "1/3", "-1/3"]) {
      expect(keys).toContain(key);
    }
  });

  it("TP-1.10: allocate has at least 6 cases including 100/[1,1,1], −100/[1,1,1], 0/[1,2], 1/[0,1] and 5/[1,1]", () => {
    const cases = loadVectors("allocate");
    const keys = new Set(cases.map((c) => `${c.minor}/[${c.weights.join(",")}]`));

    expect(cases.length).toBeGreaterThanOrEqual(6);
    for (const key of ["100/[1,1,1]", "-100/[1,1,1]", "0/[1,2]", "1/[0,1]", "5/[1,1]"]) {
      expect(keys).toContain(key);
    }
  });

  it("TP-1.10: convert has at least 6 cases including EGP→JPY, JPY→KWD, USD→EGP and 9000000000000000 EGP→USD", () => {
    const cases = loadVectors("convert");
    const pairs = new Set(cases.map((c) => `${c.from.currency}→${c.to.currency}`));

    expect(cases.length).toBeGreaterThanOrEqual(6);
    for (const pair of ["EGP→JPY", "JPY→KWD", "USD→EGP"]) {
      expect(pairs).toContain(pair);
    }
    expect(
      cases.some(
        (c) =>
          c.minor === "9000000000000000" && c.from.currency === "EGP" && c.to.currency === "USD",
      ),
    ).toBe(true);
  });

  it("TP-1.10: wire includes ±(2^53 − 1) and ±2^53", () => {
    const minors = new Set(loadVectors("wire").map((c) => c.minor));

    for (const minor of [
      "9007199254740991",
      "-9007199254740991",
      "9007199254740992",
      "-9007199254740992",
    ]) {
      expect(minors).toContain(minor);
    }
  });

  it("TP-1.10: format covers EGP, JPY and KWD in en-US and de-DE, each with a negative", () => {
    const cases = loadVectors("format");

    for (const currency of ["EGP", "JPY", "KWD"]) {
      for (const locale of ["en-US", "de-DE"]) {
        const matching = cases.filter((c) => c.currency === currency && c.locale === locale);
        expect(matching.some((c) => !c.minor.startsWith("-"))).toBe(true);
        expect(matching.some((c) => c.minor.startsWith("-"))).toBe(true);
      }
    }
  });

  it("TP-1.10: every format case is CLDR-stable: en-US or de-DE, currencyDisplay code (or absent), EGP/JPY/KWD, space-normalised (A-37)", () => {
    const problems: string[] = [];
    for (const c of loadVectors("format") as (FormatCase & {
      currencyDisplay?: string;
      signDisplay?: string;
    })[]) {
      const label = `${c.minor} ${c.currency} ${c.locale}`;
      if (!["en-US", "de-DE"].includes(c.locale)) problems.push(`${label}: locale`);
      if (c.currencyDisplay !== undefined && c.currencyDisplay !== "code")
        problems.push(`${label}: currencyDisplay`);
      if (c.signDisplay !== undefined && c.signDisplay !== "auto")
        problems.push(`${label}: signDisplay`);
      if (!["EGP", "JPY", "KWD"].includes(c.currency)) problems.push(`${label}: currency`);
      if (/[\u00a0\u202f]/.test(c.expected)) problems.push(`${label}: unnormalised space`);
    }

    expect(problems).toEqual([]);
  });
});
