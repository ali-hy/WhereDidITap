import { sql } from "drizzle-orm";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { audit, tstz } from "./identityColumns.js";
import { usersTable } from "./users.js";

export const emailBansTable = pgTable(
  "email_bans",
  {
    email: text().primaryKey(),
    bannedAt: tstz().notNull(),
    bannedByUserId: uuid().references(() => usersTable.id, { onDelete: "set null" }),
    ...audit,
  },
  (t) => [check("email_bans_normalised", sql`${t.email} = lower(btrim(${t.email}))`)],
);
