import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { audit, tstz } from "./identityColumns.js";
import { usersTable } from "./users.js";

export const googleIdentitiesTable = pgTable(
  "google_identities",
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    googleSub: text().notNull(),
    emailAtLink: text().notNull(),
    linkedAt: tstz().notNull(),
    lastUsedAt: tstz(),
    ...audit,
  },
  (t) => [
    uniqueIndex("google_identities_user_key").on(t.userId),
    uniqueIndex("google_identities_sub_key").on(t.googleSub),
    check("google_identities_sub_len", sql`char_length(${t.googleSub}) BETWEEN 1 AND 255`),
  ],
);
