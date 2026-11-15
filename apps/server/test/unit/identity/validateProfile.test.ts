// F-90 validateProfile (identity LLD §4.8, §6). TP-1.13, TP-1.50 (A-53), plus extra cases TP-1.13x. The handle
// throws: none of these inputs has a baseCurrency, the only field read from the database.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import type { IdentityDeps } from "../../../src/identity/identityModule.js";
import { validateProfile } from "../../../src/identity/profileService.js";
import { testApiConfig } from "../../support/api.js";
import { devApi, prodApi } from "../../support/configEnv.js";

const noDatabase = {
  executeSql: () => Promise.reject(new Error("validateProfile read the database")),
} as unknown as DbHandle;

const depsIn = (appEnv: "test" | "production"): IdentityDeps =>
  ({
    config:
      appEnv === "production"
        ? testApiConfig({}, () => prodApi("production"))
        : testApiConfig({ APP_ENV: "test" }, devApi),
  }) as unknown as IdentityDeps;

describe("TP-1.13: validateProfile", () => {
  it("TP-1.13: locale en-XA is accepted in test", async () => {
    const r = await validateProfile(depsIn("test"), noDatabase, { locale: "en-XA" });

    expect(r.issues).toEqual([]);
    expect(r.value).toMatchObject({ locale: "en-XA" });
  });

  it("TP-1.13: locale en-XA in production → unsupported_locale", async () => {
    const r = await validateProfile(depsIn("production"), noDatabase, { locale: "en-XA" });

    expect(r.issues).toEqual([
      { path: ["locale"], code: "unsupported_locale", message: "Unsupported locale" },
    ]);
  });

  it("TP-1.13: an 81-character name → too_big", async () => {
    const r = await validateProfile(depsIn("test"), noDatabase, { displayName: "a".repeat(81) });

    expect(r.issues).toEqual([{ path: ["displayName"], code: "too_big", message: "Too big" }]);
  });

  it("TP-1.13: a name with U+0001 → invalid_format", async () => {
    const r = await validateProfile(depsIn("test"), noDatabase, { displayName: "Mona\u0001" });

    expect(r.issues).toEqual([
      { path: ["displayName"], code: "invalid_format", message: "Invalid format" },
    ]);
  });

  it("TP-1.13x: 80 characters after trimming pass; the value is trimmed and NFC-normalised", async () => {
    const name = `  ${"a".repeat(79)}é  `;

    const r = await validateProfile(depsIn("test"), noDatabase, { displayName: name });

    expect(r.issues).toEqual([]);
    expect(r.value.displayName).toBe(`${"a".repeat(79)}é`);
  });

  it.each([[""], ["   "]])("TP-1.13x: name %j → too_small", async (displayName) => {
    const r = await validateProfile(depsIn("test"), noDatabase, { displayName });

    expect(r.issues).toEqual([{ path: ["displayName"], code: "too_small", message: "Too small" }]);
  });

  it.each([["Etc/Unknown"], ["+02:00"], ["Mars/Base"]])(
    "TP-1.13x: time zone %j → invalid_time_zone",
    async (timeZone) => {
      const r = await validateProfile(depsIn("test"), noDatabase, { timeZone });

      expect(r.issues).toEqual([
        { path: ["timeZone"], code: "invalid_time_zone", message: "Invalid time zone" },
      ]);
    },
  );

  it("TP-1.13x: locale en is accepted in production; fr is unsupported in test", async () => {
    expect(
      (await validateProfile(depsIn("production"), noDatabase, { locale: "en" })).issues,
    ).toEqual([]);
    expect(
      (await validateProfile(depsIn("test"), noDatabase, { locale: "fr" })).issues.map(
        (i) => i.code,
      ),
    ).toEqual(["unsupported_locale"]);
  });
});

describe("TP-1.50: validateProfile with the UTC zone (A-53)", () => {
  it("TP-1.50: timeZone UTC → no issue, the value UTC", async () => {
    const r = await validateProfile(depsIn("test"), noDatabase, { timeZone: "UTC" });

    expect(r.issues).toEqual([]);
    expect(r.value.timeZone).toBe("UTC");
  });

  it("TP-1.50: timeZone Etc/UTC → no issue, the runtime's canonical name", async () => {
    const canonical = new Intl.DateTimeFormat("en", { timeZone: "Etc/UTC" }).resolvedOptions()
      .timeZone;

    const r = await validateProfile(depsIn("test"), noDatabase, { timeZone: "Etc/UTC" });

    expect(r.issues).toEqual([]);
    expect(r.value.timeZone).toBe(canonical);
  });
});
