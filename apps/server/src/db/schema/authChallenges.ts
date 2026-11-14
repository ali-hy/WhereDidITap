import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ChallengeData } from "../../identity/challengesRepo.js";
import { audit, tstz } from "./identityColumns.js";
import { invitationsTable } from "./invitations.js";
import { sessionsTable } from "./sessions.js";
import { bytea } from "./types.js";
import { usersTable } from "./users.js";

export const authChallengesTable = pgTable(
  "auth_challenges",
  {
    id: uuid().primaryKey(),
    kind: text().notNull(),
    tokenHash: bytea().notNull(),
    // google_web: the hand-off token hash after the callback.
    secondaryHash: bytea(),
    // google_web: the binding cookie hash.
    bindingHash: bytea(),
    userId: uuid().references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: uuid().references(() => sessionsTable.id, { onDelete: "cascade" }),
    invitationId: uuid().references(() => invitationsTable.id, { onDelete: "cascade" }),
    data: jsonb()
      .$type<ChallengeData>()
      .notNull()
      .default({} as ChallengeData),
    attempts: smallint().notNull().default(0),
    expiresAt: tstz().notNull(),
    consumedAt: tstz(),
    ...audit,
  },
  (t) => [
    uniqueIndex("auth_challenges_token_key").on(t.tokenHash),
    uniqueIndex("auth_challenges_secondary_key")
      .on(t.secondaryHash)
      .where(sql`${t.secondaryHash} IS NOT NULL`),
    index("auth_challenges_expires_idx").on(t.expiresAt),
    check(
      "auth_challenges_kind",
      sql`${t.kind} IN ('two_step', 'google_web', 'google_nonce', 'google_signup')`,
    ),
    check("auth_challenges_attempts", sql`${t.attempts} BETWEEN 0 AND 5`),
  ],
);
