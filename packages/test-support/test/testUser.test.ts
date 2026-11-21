// createTestUser (A-234, identity LLD §10.1). Extra cases TP-7.19x; TP-0.34's database half is in
// apps/server/test/integration/identity/testUser.test.ts. IDs ending in "x" are test-architect
// additions, not LLD test-plan IDs.
import { describe, expect, it, vi } from "vitest";
import { createTestUser, testUserEmail, type TestUserDatabase } from "../src/index.js";

/** F-311's isUuid pattern (packages/shared/src/ids/ids.ts). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function database(): {
  db: TestUserDatabase;
  executeSql: ReturnType<
    typeof vi.fn<(text: string, values?: readonly unknown[]) => Promise<unknown>>
  >;
} {
  const executeSql = vi.fn<(text: string, values?: readonly unknown[]) => Promise<unknown>>(() =>
    Promise.resolve({ rows: [] }),
  );
  return { db: { database: { handle: { executeSql } } }, executeSql };
}

describe("TP-7.19x: createTestUser (A-234)", () => {
  it("TP-7.19x: returns a lower-case UUIDv7 and inserts exactly one users row with §10.1's values", async () => {
    const { db, executeSql } = database();

    const id = await createTestUser(db);

    expect(id).toMatch(UUID);
    expect(id[14]).toBe("7");
    expect(executeSql).toHaveBeenCalledTimes(1);
    const [text, values] = executeSql.mock.calls[0] ?? [];
    expect(text).toMatch(
      /^INSERT INTO users \(id, email, display_name, locale, time_zone, base_currency\) VALUES/,
    );
    expect(values).toEqual([id, `test-${id}@example.invalid`, "Test User", "en", "UTC", "USD"]);
    expect(testUserEmail(id)).toBe(`test-${id}@example.invalid`);
  });

  it("TP-7.19x: two calls give different ids, and the time prefix is now", async () => {
    const { db } = database();
    const before = Date.now();

    const a = await createTestUser(db);
    const b = await createTestUser(db);

    expect(a).not.toBe(b);
    const ms = Number.parseInt(a.replace(/-/g, "").slice(0, 12), 16);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(Date.now());
  });

  it("TP-7.19x: a failing insert rejects (no id is returned for a row that doesn't exist)", async () => {
    const { db, executeSql } = database();
    executeSql.mockRejectedValueOnce(new Error('relation "users" does not exist'));

    await expect(createTestUser(db)).rejects.toThrow('relation "users" does not exist');
  });
});
