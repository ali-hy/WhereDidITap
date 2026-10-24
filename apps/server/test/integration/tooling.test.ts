// TP-2.17: the integration tooling (§10.1). A test file connects as budmon_app to its own
// t_<random> copy of the template; resetBetweenTests empties tables but keeps currencies.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  resetBetweenTests,
  type TestDatabase,
} from "../support/testDatabase.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.drop();
});

describe("TP-2.17: test tooling", () => {
  it("TP-2.17: connects as budmon_app to a per-file t_ database", async () => {
    const { rows } = await testDb.database.handle.executeSql(
      "SELECT current_user AS u, current_database() AS d, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su",
    );

    expect(rows[0]?.["u"]).toBe("budmon_app");
    expect(rows[0]?.["d"]).toBe(testDb.name);
    expect(String(rows[0]?.["d"])).toMatch(/^t_[0-9a-f]+$/);
    expect(rows[0]?.["su"]).toBe(false);
  });

  it("TP-2.47x: the copy holds the template's schema and reference data", async () => {
    const { rows } = await testDb.database.handle.executeSql(
      "SELECT minor_units FROM currencies WHERE code = 'EGP'",
    );

    expect(rows).toEqual([{ minor_units: 2 }]);
  });

  it("TP-2.47x: resetBetweenTests truncates platform tables and keeps currencies", async () => {
    const app = testDb.database.handle;
    await app.executeSql(
      "INSERT INTO rate_limit_counters (bucket_key, window_start, hits, expires_at) VALUES ('t:x', now(), 1, now() + interval '10 minutes')",
    );

    await resetBetweenTests(testDb);

    const counters = await app.executeSql("SELECT count(*)::int AS n FROM rate_limit_counters");
    const currencies = await app.executeSql("SELECT count(*)::int AS n FROM currencies");
    expect(counters.rows[0]?.["n"]).toBe(0);
    expect(Number(currencies.rows[0]?.["n"])).toBeGreaterThan(100);
  });
});
