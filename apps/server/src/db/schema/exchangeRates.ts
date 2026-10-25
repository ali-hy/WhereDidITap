import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { currenciesTable } from "./currencies.js";

export const exchangeRatesTable = pgTable(
  "exchange_rates",
  {
    currencyCode: char({ length: 3 })
      .notNull()
      .references(() => currenciesTable.code, { onDelete: "restrict", onUpdate: "restrict" }),
    rateDate: date({ mode: "string" }).notNull(),
    unitsPerUsd: numeric({ precision: 24, scale: 12 }).notNull(),
    provider: text().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.currencyCode, t.rateDate] }),
    index("exchange_rates_rate_date_idx").on(t.rateDate),
    check("exchange_rates_positive", sql`${t.unitsPerUsd} > 0`),
    check(
      "exchange_rates_provider",
      sql`${t.provider} IN ('openexchangerates', 'fawazahmed0', 'fixed')`,
    ),
  ],
);
