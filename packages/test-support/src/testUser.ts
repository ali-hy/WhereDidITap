// createTestUser (A-234): the only way platform tests obtain a userId. Owned by the
// test-architect.
//
// From identity's S-0 (identity LLD §10.1, TP-0.34) it inserts a real `users` row, so platform
// rows that reference `users` (identity's FK on idempotency_records) have a parent.
import { randomBytes } from "node:crypto";

/** The part of a test database (apps/server/test/support/testDatabase.ts) this helper may use. */
export interface TestUserDatabase {
  readonly database: {
    readonly handle: {
      executeSql: (text: string, values?: readonly unknown[]) => Promise<unknown>;
    };
  };
}

/** A lower-case RFC 9562 UUIDv7: 48-bit Unix milliseconds, version 7, variant 10. */
function uuidv7(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The inserted row's values (identity LLD §10.1). */
export function testUserEmail(id: string): string {
  return `test-${id}@example.invalid`;
}

/**
 * Inserts `users (id, email, display_name, locale, time_zone, base_currency)` = (a fresh UUIDv7,
 * `test-<id>@example.invalid`, "Test User", en, UTC, USD) and returns the id.
 */
export async function createTestUser(db: TestUserDatabase): Promise<string> {
  const id = uuidv7();
  await db.database.handle.executeSql(
    "INSERT INTO users (id, email, display_name, locale, time_zone, base_currency) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, testUserEmail(id), "Test User", "en", "UTC", "USD"],
  );
  return id;
}
