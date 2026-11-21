// F-172 sign-up defaults (identity LLD §4.14). TP-1.33, TP-1.49 (A-53), plus extra cases ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultCurrencyFor,
  defaultTimeZone,
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

  it("TP-1.33x: timeZoneOptions lists every supported zone (plus UTC, A-53), sorted by name", () => {
    const options = timeZoneOptions(ON);
    const ids = options.map((o) => o.id);

    const supported = [...Intl.supportedValuesOf("timeZone")];
    const expected = supported.includes("UTC") ? supported : [...supported, "UTC"];
    expect([...ids].sort()).toEqual([...expected].sort());
    // Sorted by name: by code unit or by locale collation, either way.
    const byCodeUnit = [...ids].sort();
    const byLocale = [...ids].sort((a, b) => a.localeCompare(b));
    expect([byCodeUnit, byLocale]).toContainEqual(ids);
  });

  it("TP-1.33x: deviceTimeZone is the runtime's resolved zone", () => {
    expect(deviceTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("TP-1.49: timeZoneOptions with UTC, and defaultTimeZone (A-53)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const stubZones = (zones: string[]) =>
    vi.spyOn(Intl, "supportedValuesOf").mockImplementation(() => zones);

  it.each([
    ["without UTC", ["Europe/London", "Africa/Cairo", "Asia/Calcutta"]],
    ["with UTC", ["Europe/London", "UTC", "Africa/Cairo", "Asia/Calcutta"]],
  ])(
    "TP-1.49: the runtime's list %s → UTC exactly once, labelled 'UTC (GMT)', in name order",
    (_label, zones) => {
      stubZones(zones);

      const options = timeZoneOptions(ON);

      expect(options.map((o) => o.id)).toEqual([
        "Africa/Cairo",
        "Asia/Calcutta",
        "Europe/London",
        "UTC",
      ]);
      expect(options.filter((o) => o.id === "UTC")).toHaveLength(1);
      expect(options.find((o) => o.id === "UTC")?.label).toBe("UTC (GMT)");
    },
  );

  it("TP-1.49: defaultTimeZone for UTC, Etc/UTC, GMT, Africa/Cairo, Asia/Calcutta, Mars/Base", () => {
    const options = timeZoneOptions(ON);
    const ids = options.map((o) => o.id);
    // The canonical name when the runtime canonicalises; else the input when it's listed.
    const calcutta = ids.includes("Asia/Calcutta") ? "Asia/Calcutta" : "Asia/Kolkata";

    expect(defaultTimeZone("UTC", options)).toBe("UTC");
    expect(defaultTimeZone("Etc/UTC", options)).toBe("UTC");
    expect(defaultTimeZone("GMT", options)).toBe("UTC");
    expect(defaultTimeZone("Africa/Cairo", options)).toBe("Africa/Cairo");
    expect(defaultTimeZone("Asia/Calcutta", options)).toBe(calcutta);
    expect(defaultTimeZone("Mars/Base", options)).toBeNull();
  });

  it.each([
    "UTC",
    "Etc/UTC",
    "Etc/UCT",
    "UCT",
    "Etc/Universal",
    "Universal",
    "Etc/Zulu",
    "Zulu",
    "GMT",
    "Etc/GMT",
    "Etc/GMT0",
    "GMT0",
    "Etc/GMT+0",
    "Etc/GMT-0",
    "GMT+0",
    "GMT-0",
    "Etc/Greenwich",
    "Greenwich",
  ])("TP-1.49x: the UTC alias %s → UTC, even when the runtime's list has no UTC", (alias) => {
    stubZones(["Africa/Cairo", "Europe/London"]);

    expect(defaultTimeZone(alias, timeZoneOptions(ON))).toBe("UTC");
  });

  it("TP-1.49x: an alias whose canonical name isn't an option, and an empty option list → null", () => {
    expect(defaultTimeZone("Asia/Calcutta", [{ id: "Africa/Cairo" }])).toBeNull();
    expect(defaultTimeZone("Africa/Cairo", [])).toBeNull();
  });
});
