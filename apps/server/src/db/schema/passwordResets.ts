import { sql } from "drizzle-orm";
import { check, index, pgTable, smallint, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { audit, tstz } from "./identityColumns.js";
import { bytea } from "./types.js";
import { usersTable } from "./users.js";

export const passwordResetsTable = pgTable(
  "password_resets",
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Null until the email job issues the token.
    tokenHash: bytea(),
    expiresAt: tstz().notNull(),
    failedCodes: smallint().notNull().default(0),
    usedAt: tstz(),
    invalidatedAt: tstz(),
    ...audit,
  },
  (t) => [
    uniqueIndex("password_resets_token_key")
      .on(t.tokenHash)
      .where(sql`${t.tokenHash} IS NOT NULL`),
    index("password_resets_user_idx").on(t.userId),
    check("password_resets_failed_codes", sql`${t.failedCodes} BETWEEN 0 AND 5`),
  ],
);
