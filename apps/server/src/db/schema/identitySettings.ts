import { sql } from "drizzle-orm";
import { check, integer, pgTable, smallint } from "drizzle-orm/pg-core";
import { audit } from "./identityColumns.js";

export const identitySettingsTable = pgTable(
  "identity_settings",
  {
    id: smallint().primaryKey(),
    userCap: integer().notNull().default(90),
    ...audit,
  },
  (t) => [
    check("identity_settings_singleton", sql`${t.id} = 1`),
    check("identity_settings_cap", sql`${t.userCap} >= 1`),
  ],
);
