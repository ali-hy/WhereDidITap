// createTestUser (A-234): the only way platform tests obtain a userId. Owned by the
// test-architect.
//
// Until identity exists it returns a fresh lower-case UUIDv7 without touching the database.
// identity's S-0 changes this body to insert a real `users` row through `db`, so platform tests
// don't change when identity's foreign key to `users` arrives.
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `db` is part of A-234's signature; identity's S-0 uses it to insert the user
export function createTestUser(db: TestUserDatabase): Promise<string> {
  return Promise.resolve(uuidv7());
}
