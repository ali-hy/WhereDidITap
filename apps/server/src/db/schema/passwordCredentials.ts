import { sql } from "drizzle-orm";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { audit } from "./identityColumns.js";
import { usersTable } from "./users.js";

export const passwordCredentialsTable = pgTable(
  "password_credentials",
  {
    userId: uuid()
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    passwordHash: text().notNull(),
    ...audit,
  },
  (t) => [check("password_credentials_phc", sql`${t.passwordHash} LIKE '$argon2id$%'`)],
);
