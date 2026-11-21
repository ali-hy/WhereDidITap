import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { audit, tstz } from "./identityColumns.js";
import { bytea } from "./types.js";
import { usersTable } from "./users.js";

export const sessionsTable = pgTable(
  "sessions",
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    delivery: text().notNull(),
    clientKind: text().notNull(),
    deviceLabel: text().notNull(),
    authMethod: text().notNull(),
    accessTokenHash: bytea().notNull(),
    accessExpiresAt: tstz().notNull(),
    // session_refresh_tokens.id; no FK (circular), checked by the repo.
    currentRefreshId: uuid().notNull(),
    // No absolute expiry (HLD D-2).
    idleExpiresAt: tstz().notNull(),
    confirmedAt: tstz(),
    lastUsedAt: tstz().notNull(),
    revokedAt: tstz(),
    revokeReason: text(),
    ...audit,
  },
  (t) => [
    uniqueIndex("sessions_access_hash_key").on(t.accessTokenHash),
    index("sessions_user_live_idx")
      .on(t.userId, t.lastUsedAt)
      .where(sql`${t.revokedAt} IS NULL`),
    index("sessions_revoked_idx")
      .on(t.revokedAt)
      .where(sql`${t.revokedAt} IS NOT NULL`),
    index("sessions_idle_expiry_idx").on(t.idleExpiresAt),
    check("sessions_delivery", sql`${t.delivery} IN ('cookie', 'bearer')`),
    check("sessions_client_kind", sql`${t.clientKind} IN ('web', 'android', 'other')`),
    check(
      "sessions_auth_method",
      sql`${t.authMethod} IN ('password', 'google', 'reset', 'sign_up')`,
    ),
    check("sessions_device_label_len", sql`char_length(${t.deviceLabel}) BETWEEN 1 AND 80`),
    check(
      "sessions_revoke_reason",
      sql`(${t.revokedAt} IS NULL AND ${t.revokeReason} IS NULL) OR (${t.revokedAt} IS NOT NULL AND ${t.revokeReason} IN
     ('sign_out', 'revoked_by_user', 'other_devices', 'limit', 'reuse_detected', 'password_reset', 'password_changed', 'two_step_enabled', 'deletion', 'owner_deletion', 'ban', 'two_step_reset_by_owner'))`,
    ),
    check("sessions_hash_len", sql`octet_length(${t.accessTokenHash}) = 32`),
  ],
);
