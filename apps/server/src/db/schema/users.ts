import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { currenciesTable } from "./currencies.js";
import { audit, tstz } from "./identityColumns.js";

export const usersTable = pgTable(
  "users",
  {
    id: uuid().primaryKey(),
    email: text().notNull(),
    emailVerifiedAt: tstz(),
    displayName: text().notNull(),
    locale: text().notNull(),
    timeZone: text().notNull(),
    baseCurrency: char({ length: 3 })
      .notNull()
      .references(() => currenciesTable.code, { onDelete: "restrict", onUpdate: "restrict" }),
    status: text().notNull().default("active"),
    deletionRequestedAt: tstz(),
    deletionScheduledFor: tstz(),
    deletionRequestedBy: text(),
    isProductOwner: boolean().notNull().default(false),
    inviteAllowance: integer().default(3),
    invitedByUserId: uuid().references((): AnyPgColumn => usersTable.id, {
      onDelete: "set null",
    }),
    lastActiveAt: tstz(),
    ...audit,
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    uniqueIndex("users_single_owner")
      .on(t.isProductOwner)
      .where(sql`${t.isProductOwner}`),
    index("users_deletion_due_idx")
      .on(t.deletionScheduledFor)
      .where(sql`${t.status} = 'pending_deletion'`),
    index("users_created_id_idx").on(t.createdAt, t.id),
    check(
      "users_email_format",
      sql`${t.email} = lower(btrim(${t.email})) AND char_length(${t.email}) BETWEEN 3 AND 254 AND ${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`,
    ),
    check("users_display_name_len", sql`char_length(${t.displayName}) BETWEEN 1 AND 80`),
    check("users_locale_format", sql`${t.locale} ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'`),
    check("users_status", sql`${t.status} IN ('active', 'pending_deletion')`),
    check(
      "users_deletion_by",
      sql`${t.deletionRequestedBy} IS NULL OR ${t.deletionRequestedBy} IN ('self', 'owner', 'ban')`,
    ),
    check(
      "users_deletion_consistent",
      sql`(${t.status} = 'active' AND ${t.deletionRequestedAt} IS NULL AND ${t.deletionScheduledFor} IS NULL AND ${t.deletionRequestedBy} IS NULL)
     OR (${t.status} = 'pending_deletion' AND ${t.deletionRequestedAt} IS NOT NULL AND ${t.deletionScheduledFor} IS NOT NULL AND ${t.deletionRequestedBy} IS NOT NULL)`,
    ),
    check("users_allowance_nonneg", sql`${t.inviteAllowance} IS NULL OR ${t.inviteAllowance} >= 0`),
  ],
);
