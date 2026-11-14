import { timestamp } from "drizzle-orm/pg-core";

/** A timestamp with time zone. */
export const tstz = () => timestamp({ withTimezone: true });

/** `created_at` and `updated_at`, on every identity table. */
export const audit = {
  createdAt: tstz().notNull().defaultNow(),
  updatedAt: tstz().notNull().defaultNow(),
};
