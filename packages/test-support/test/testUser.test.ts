// createTestUser (A-234). Extra cases TP-7.19x. IDs ending in "x" are test-architect additions,
// not LLD test-plan IDs.
import { describe, expect, it, vi } from "vitest";
import { createTestUser, type TestUserDatabase } from "../src/index.js";

/** F-311's isUuid pattern (packages/shared/src/ids/ids.ts). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function database(): { db: TestUserDatabase; executeSql: ReturnType<typeof vi.fn> } {
  const executeSql = vi.fn(() => Promise.reject(new Error("no database access expected")));
  return { db: { database: { handle: { executeSql } } }, executeSql };
}

describe("TP-7.19x: createTestUser (A-234)", () => {
  it("TP-7.19x: returns a lower-case UUIDv7 that passes isUuid, without touching the database", async () => {
    const { db, executeSql } = database();

    const id = await createTestUser(db);

    expect(id).toMatch(UUID);
    expect(id[14]).toBe("7");
    expect(executeSql).not.toHaveBeenCalled();
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
});
