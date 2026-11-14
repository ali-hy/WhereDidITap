import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { audit, tstz } from "./identityColumns.js";
import { sessionsTable } from "./sessions.js";
import { bytea } from "./types.js";

export const sessionRefreshTokensTable = pgTable(
  "session_refresh_tokens",
  {
    id: uuid().primaryKey(),
    sessionId: uuid()
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    // The token it was issued from; null for the first; same session.
    parentId: uuid(),
    tokenHash: bytea().notNull(),
    generation: integer().notNull(),
    issuedAt: tstz().notNull(),
    firstPresentedAt: tstz(),
    supersededAt: tstz(),
    supersededReason: text(),
    ...audit,
  },
  (t) => [
    uniqueIndex("session_refresh_tokens_hash_key").on(t.tokenHash),
    index("session_refresh_tokens_session_idx").on(t.sessionId),
    index("session_refresh_tokens_prune_idx")
      .on(t.issuedAt)
      .where(sql`${t.supersededAt} IS NOT NULL`),
    check(
      "srt_superseded_shape",
      sql`(${t.supersededAt} IS NULL AND ${t.supersededReason} IS NULL) OR (${t.supersededAt} IS NOT NULL AND ${t.supersededReason} IN ('rotated', 'discarded'))`,
    ),
    check("srt_hash_len", sql`octet_length(${t.tokenHash}) = 32`),
    check("srt_generation_pos", sql`${t.generation} >= 1`),
  ],
);
