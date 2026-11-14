import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { SECURITY_EVENT_KINDS } from "../../identity/constants.js";
import { audit } from "./identityColumns.js";
import { usersTable } from "./users.js";

export const securityEventsTable = pgTable(
  "security_events",
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    // No FK: survives the session's purge.
    sessionId: uuid(),
    clientKind: text(),
    ...audit,
  },
  (t) => [
    index("security_events_user_idx").on(t.userId, t.createdAt),
    index("security_events_created_idx").on(t.createdAt),
    check(
      "security_events_kind",
      sql`${t.kind} IN (${sql.raw(SECURITY_EVENT_KINDS.map((k) => `'${k}'`).join(", "))})`,
    ),
  ],
);
