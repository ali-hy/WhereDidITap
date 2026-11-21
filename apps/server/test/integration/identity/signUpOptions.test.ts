// auth.signUpOptions (F-59; identity LLD §5.2). TP-1.12, plus extra cases TP-1.12x.
// Its own container: F-59 caches its answer in memory, so the currency change is made first.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildIdentityApi, type IdentityApi } from "../../support/identity.js";
import { call } from "../../support/identityHttp.js";

let api: IdentityApi;
let active: { code: string; minorUnits: number }[];
let INACTIVE: string;

beforeAll(async () => {
  api = await buildIdentityApi({ env: { APP_ENV: "test" } });
  const migrator = api.testDb.connectAs("budmon_migrator");
  try {
    // One active currency other than USD becomes inactive.
    const before = await migrator.handle.executeSql(
      "SELECT code FROM currencies WHERE is_active AND code <> 'USD' ORDER BY code LIMIT 1",
    );
    INACTIVE = String(before.rows[0]?.["code"]);
    await migrator.handle.executeSql("UPDATE currencies SET is_active = false WHERE code = $1", [
      INACTIVE,
    ]);
    const { rows } = await migrator.handle.executeSql(
      "SELECT code, minor_units FROM currencies WHERE is_active ORDER BY code",
    );
    active = rows.map((r) => ({
      code: String(r["code"]),
      minorUnits: Number(r["minor_units"]),
    }));
  } finally {
    await migrator.close();
  }
}, 60_000);

afterAll(async () => {
  await api.close();
});

describe("TP-1.12: auth.signUpOptions", () => {
  it("TP-1.12: public GET /auth/sign-up-options lists the active currencies ordered by code, and the locales en, en-XA, ar-XB in test", async () => {
    const res = await call(api.app, "GET", "/auth/sign-up-options");

    expect(res.status).toBe(200);
    const body = res.json() as {
      currencies: { code: string; minorUnits: number }[];
      locales: string[];
    };
    expect(active.length).toBeGreaterThan(1);
    expect(body.currencies).toEqual(active);
    expect(body.currencies.map((c) => c.code)).not.toContain(INACTIVE);
    expect([...body.locales].sort()).toEqual(["ar-XB", "en", "en-XA"]);
  });

  it("TP-1.12x: no credentials are needed, and a second call answers the same", async () => {
    const first = await call(api.app, "GET", "/auth/sign-up-options");
    const second = await call(api.app, "GET", "/auth/sign-up-options");

    expect(first.status).toBe(200);
    expect(second.json()).toEqual(first.json());
  });
});
