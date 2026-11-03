import { sql } from "drizzle-orm";
import { boolean, char, check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

export const currenciesTable = pgTable(
  "currencies",
  {
    code: char({ length: 3 }).primaryKey(),
    name: text().notNull(),
    minorUnits: smallint().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("currencies_code_format", sql`${t.code} ~ '^[A-Z]{3}$'`),
    check("currencies_minor_units_range", sql`${t.minorUnits} BETWEEN 0 AND 4`),
  ],
);
