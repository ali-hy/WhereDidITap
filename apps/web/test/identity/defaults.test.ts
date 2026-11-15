// F-172 sign-up defaults (identity LLD §4.14). TP-1.33, plus extra cases TP-1.33x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { describe, expect, it } from "vitest";
import {
  defaultCurrencyFor,
  deviceTimeZone,
  timeZoneOptions,
} from "../../src/identity/defaults.js";

const WITHOUT_EGP = ["EUR", "GBP", "USD"];
const WITH_EGP = ["EGP", "EUR", "GBP", "USD"];
const ON = Temporal.Instant.from("2026-10-07T12:00:00Z");

describe("TP-1.33: defaultCurrencyFor and timeZoneOptions", () => {
  it("TP-1.33: en-EG without EGP active → USD; with EGP → EGP; en → USD", () => {
    expect(defaultCurrencyFor("en-EG", WITHOUT_EGP)).toBe("USD");
    expect(defaultCurrencyFor("en-EG", WITH_EGP)).toBe("EGP");
    expect(defaultCurrencyFor("en", WITH_EGP)).toBe("USD");
  });

  it("TP-1.33: Africa/Cairo on 2026-10-07 is labelled 'Africa/Cairo (GMT+3)'", () => {
    const cairo = timeZoneOptions(ON).find((o) => o.id === "Africa/Cairo");

    expect(cairo?.label).toBe("Africa/Cairo (GMT+3)");
  });

  it("TP-1.33x: a region the map knows, with its currency active (en-GB → GBP); an unknown region → USD", () => {
    expect(defaultCurrencyFor("en-GB", WITH_EGP)).toBe("GBP");
    expect(defaultCurrencyFor("en-ZZ", WITH_EGP)).toBe("USD");
  });

  it("TP-1.33x: timeZoneOptions lists every supported zone, sorted by name", () => {
    const options = timeZoneOptions(ON);
    const ids = options.map((o) => o.id);

    const supported = [...Intl.supportedValuesOf("timeZone")];
    expect([...ids].sort()).toEqual([...supported].sort());
    // Sorted by name: by code unit or by locale collation, either way.
    const byCodeUnit = [...ids].sort();
    const byLocale = [...ids].sort((a, b) => a.localeCompare(b));
    expect([byCodeUnit, byLocale]).toContainEqual(ids);
  });

  it("TP-1.33x: deviceTimeZone is the runtime's resolved zone", () => {
    expect(deviceTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
