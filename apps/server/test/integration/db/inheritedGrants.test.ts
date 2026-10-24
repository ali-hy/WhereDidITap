// F-14 / F-15 inherited grants (P-7). TP-2.20, on a copy of the template after the schema step.
// TP-2.20's `SELECT count(*) FROM pgboss.job` as budmon_migrator needs the queue schema (S-6,
// F-19 step 3, F-74).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../../src/platform/db/types.js";
import { failureState } from "../../support/postgres.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";

let testDb: TestDatabase;
let migrator: Database;
let monitor: Database;

beforeAll(async () => {
  testDb = await createTestDatabase("budmon_app");
  migrator = testDb.connectAs("budmon_migrator");
  monitor = testDb.connectAs("budmon_monitor");
});

afterAll(async () => {
  await migrator.close();
  await monitor.close();
  await testDb.drop();
});

describe("TP-2.20: inherited grants", () => {
  it("TP-2.20: budmon_migrator can run bt_index_check on currencies_pkey", async () => {
    expect(
      await failureState(() =>
        migrator.handle.executeSql("SELECT bt_index_check('currencies_pkey'::regclass, true)"),
      ),
    ).toBeUndefined();
  });

  it("TP-2.20: (A-229) as budmon_migrator, SELECT count(*) FROM pgboss.job is 0, with no error", async () => {
    // Jobs exist, but RLS (A-228) shows them only to the owner budmon_queue and roles with a
    // policy; pg_read_all_data doesn't bypass it.
    const queue = testDb.connectAs("budmon_queue");
    try {
      await queue.handle.executeSql("INSERT INTO pgboss.job (name, data) VALUES ('test.ok', '{}')");
    } finally {
      await queue.close();
    }

    const { rows } = await migrator.handle.executeSql("SELECT count(*)::int AS n FROM pgboss.job");

    expect(rows[0]?.["n"]).toBe(0);
  });

  it("TP-2.20: budmon_monitor sees budmon_app's sessions in pg_stat_activity (pg_monitor inherited)", async () => {
    // Keep a budmon_app session open while the monitor looks.
    await testDb.database.handle.executeSql("SELECT 1");
    const client = await testDb.database.pool.connect();
    try {
      const { rows } = await monitor.handle.executeSql(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = 'budmon_app' AND query IS NOT NULL AND query <> '<insufficient privilege>'",
      );

      expect(rows[0]?.["n"]).toBeGreaterThanOrEqual(1);
    } finally {
      client.release();
    }
  });
});
