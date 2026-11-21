import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { audit, tstz } from "./identityColumns.js";
import { bytea } from "./types.js";
import { usersTable } from "./users.js";

export const recoveryCodesTable = pgTable(
  "recovery_codes",
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    keyId: text().notNull(),
    codeHmac: bytea().notNull(),
    usedAt: tstz(),
    ...audit,
  },
  (t) => [
    uniqueIndex("recovery_codes_lookup_key").on(t.userId, t.keyId, t.codeHmac),
    check("recovery_codes_hmac_len", sql`octet_length(${t.codeHmac}) = 32`),
  ],
);
