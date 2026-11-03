import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// UNLOGGED: Drizzle has no flag for it, so the push step (F-17) and the baseline release
// migration run `ALTER TABLE "rate_limit_counters" SET UNLOGGED` after creating it.
export const rateLimitCountersTable = pgTable(
  "rate_limit_counters",
  {
    bucketKey: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    hits: integer().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bucketKey, t.windowStart] }),
    index("rate_limit_counters_expires_at_idx").on(t.expiresAt),
  ],
);
