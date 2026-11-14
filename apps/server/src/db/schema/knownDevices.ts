import { sql } from "drizzle-orm";
import { check, index, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { audit, tstz } from "./identityColumns.js";
import { bytea } from "./types.js";
import { usersTable } from "./users.js";

export const knownDevicesTable = pgTable(
  "known_devices",
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: bytea().notNull(),
    lastUsedAt: tstz().notNull(),
    expiresAt: tstz().notNull(),
    ...audit,
  },
  (t) => [
    uniqueIndex("known_devices_hash_key").on(t.tokenHash),
    index("known_devices_user_idx").on(t.userId, t.lastUsedAt),
    index("known_devices_expires_idx").on(t.expiresAt),
    check("known_devices_hash_len", sql`octet_length(${t.tokenHash}) = 32`),
  ],
);
