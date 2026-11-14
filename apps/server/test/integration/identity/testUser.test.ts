// createTestUser with identity's FK (P-A-234, identity LLD §10.1). TP-0.34's database half; its
// other half is the platform suites themselves (`pnpm test`, `pnpm test:int`), whose changed cases
// take their S-0 expectations in this slice:
// - A-511: TP-2.29 (g), TP-2.49x, TP-4.22 (a), TP-6.12;
// - A-512: TP-2.12, TP-2.14, TP-2.16 (b), TP-2.53x, TP-2.55x.
import { createTestUser } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase("budmon_app");
});

afterAll(async () => {
  await testDb.drop();
});

const insertRecord = (userId: string) =>
  testDb.database.handle.executeSql(
    "INSERT INTO idempotency_records (user_id, idempotency_key, procedure, request_hash, expires_at) VALUES ($1, gen_random_uuid(), 'p', decode(repeat('00', 32), 'hex'), now() + interval '1 day')",
    [userId],
  );

describe("TP-0.34: createTestUser with identity's schema", () => {
  it("TP-0.34: a users row exists for the returned id, with §10.1's values", async () => {
    const userId = await createTestUser(testDb);

    const { rows } = await testDb.database.handle.executeSql(
      "SELECT email, display_name, locale, time_zone, base_currency, status FROM users WHERE id = $1",
      [userId],
    );
    expect(rows).toEqual([
      {
        email: `test-${userId}@example.invalid`,
        display_name: "Test User",
        locale: "en",
        time_zone: "UTC",
        base_currency: "USD",
        status: "active",
      },
    ]);
  });

  it("TP-0.34: an idempotency record for that id is accepted; one for a random UUID fails 23503", async () => {
    const userId = await createTestUser(testDb);

    await expect(insertRecord(userId)).resolves.toMatchObject({ rowCount: 1 });
    await expect(insertRecord("0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9aff")).rejects.toMatchObject({
      code: "23503",
    });
  });

  it("TP-0.34: two calls create two distinct users", async () => {
    const a = await createTestUser(testDb);
    const b = await createTestUser(testDb);

    const { rows } = await testDb.database.handle.executeSql(
      "SELECT count(*)::int AS n FROM users WHERE id = ANY($1::uuid[])",
      [[a, b]],
    );
    expect(a).not.toBe(b);
    expect(rows[0]?.["n"]).toBe(2);
  });
});
