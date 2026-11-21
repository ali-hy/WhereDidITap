import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea } from "./types.js";
import { usersTable } from "./users.js";

export const idempotencyRecordsTable = pgTable(
  "idempotency_records",
  {
    userId: uuid()
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    idempotencyKey: uuid().notNull(),
    procedure: text().notNull(),
    requestHash: bytea().notNull(),
    responseStatus: smallint(),
    result: jsonb().$type<{ id: string; createdAt: string }>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.idempotencyKey] }),
    index("idempotency_records_expires_at_idx").on(t.expiresAt),
    check("idempotency_records_hash_len", sql`octet_length(${t.requestHash}) = 32`),
  ],
);
