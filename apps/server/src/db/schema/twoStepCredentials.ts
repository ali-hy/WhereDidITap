import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { audit, tstz } from "./identityColumns.js";
import { bytea } from "./types.js";
import { usersTable } from "./users.js";

export const twoStepCredentialsTable = pgTable(
  "two_step_credentials",
  {
    userId: uuid()
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    state: text().notNull(),
    secretEnvelope: bytea(),
    pendingSecretEnvelope: bytea(),
    pendingExpiresAt: tstz(),
    lastUsedStep: integer(),
    enabledAt: tstz(),
    codesAcknowledged: boolean().notNull().default(false),
    ...audit,
  },
  (t) => [
    check("two_step_state", sql`${t.state} IN ('pending', 'enabled')`),
    check(
      "two_step_pending_shape",
      sql`(${t.state} = 'pending' AND ${t.secretEnvelope} IS NULL AND ${t.pendingSecretEnvelope} IS NOT NULL AND ${t.pendingExpiresAt} IS NOT NULL)
     OR (${t.state} = 'enabled' AND ${t.secretEnvelope} IS NOT NULL AND ${t.enabledAt} IS NOT NULL
         AND ((${t.pendingSecretEnvelope} IS NULL) = (${t.pendingExpiresAt} IS NULL)))`,
    ),
  ],
);
