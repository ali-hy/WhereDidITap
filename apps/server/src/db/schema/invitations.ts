import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { audit, tstz } from "./identityColumns.js";
import { bytea } from "./types.js";
import { usersTable } from "./users.js";

export const invitationsTable = pgTable(
  "invitations",
  {
    id: uuid().primaryKey(),
    email: text().notNull(),
    inviterUserId: uuid().references(() => usersTable.id, { onDelete: "set null" }),
    origin: text().notNull(),
    status: text().notNull().default("pending"),
    tokenHash: bytea(),
    tokenIssuedAt: tstz(),
    expiresAt: tstz().notNull(),
    sendCount: integer().notNull().default(0),
    lastSentAt: tstz(),
    sendFailedAt: tstz(),
    acceptedUserId: uuid().references(() => usersTable.id, { onDelete: "cascade" }),
    acceptedAt: tstz(),
    revokedAt: tstz(),
    revokedByUserId: uuid().references(() => usersTable.id, { onDelete: "set null" }),
    // When it became accepted, revoked or expired.
    endedAt: tstz(),
    ...audit,
  },
  (t) => [
    uniqueIndex("invitations_pending_email_key")
      .on(t.email)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex("invitations_token_key")
      .on(t.tokenHash)
      .where(sql`${t.tokenHash} IS NOT NULL`),
    uniqueIndex("invitations_pending_bootstrap_key")
      .on(t.origin)
      .where(sql`${t.status} = 'pending' AND ${t.origin} = 'bootstrap'`),
    index("invitations_inviter_idx").on(t.inviterUserId, t.createdAt, t.id),
    index("invitations_created_idx").on(t.createdAt, t.id),
    index("invitations_pending_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
    index("invitations_ended_idx")
      .on(t.endedAt)
      .where(sql`${t.status} IN ('revoked', 'expired')`),
    check("invitations_origin", sql`${t.origin} IN ('direct', 'account_share', 'bootstrap')`),
    check("invitations_status", sql`${t.status} IN ('pending', 'accepted', 'revoked', 'expired')`),
    check(
      "invitations_bootstrap_no_inviter",
      sql`${t.origin} <> 'bootstrap' OR ${t.inviterUserId} IS NULL`,
    ),
    check("invitations_ended_shape", sql`(${t.status} = 'pending') = (${t.endedAt} IS NULL)`),
  ],
);
