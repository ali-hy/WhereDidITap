import { timestamp } from "drizzle-orm/pg-core";

/** A timestamp with time zone, to the millisecond (keyset cursors stay exact). */
export const tstz = () => timestamp({ withTimezone: true, precision: 3 });

/** `created_at` and `updated_at`, on every identity table. */
export const audit = {
  createdAt: tstz().notNull().defaultNow(),
  updatedAt: tstz().notNull().defaultNow(),
};
