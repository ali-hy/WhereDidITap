import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { audit, tstz } from "./identityColumns.js";
import { usersTable } from "./users.js";

export const dataExportsTable = pgTable(
  "data_exports",
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: text().notNull(),
    objectKey: text(),
    // At most EXPORT_MAX_BYTES (200 MiB), below 2^31.
    byteSize: integer(),
    requestedAt: tstz().notNull(),
    startedAt: tstz(),
    completedAt: tstz(),
    expiresAt: tstz(),
    failureKey: text(),
    ...audit,
  },
  (t) => [
    index("data_exports_user_idx").on(t.userId, t.requestedAt),
    uniqueIndex("data_exports_one_active_key")
      .on(t.userId)
      .where(sql`${t.status} IN ('queued', 'running')`),
    check(
      "data_exports_status",
      sql`${t.status} IN ('queued', 'running', 'ready', 'failed', 'expired')`,
    ),
    check(
      "data_exports_ready_shape",
      sql`${t.status} <> 'ready' OR (${t.objectKey} IS NOT NULL AND ${t.expiresAt} IS NOT NULL AND ${t.byteSize} IS NOT NULL)`,
    ),
    check(
      "data_exports_failure_key",
      sql`${t.failureKey} IS NULL OR ${t.failureKey} IN ('build_failed', 'too_large', 'erased')`,
    ),
  ],
);
