// F-18: applies the committed migrations (schema step 2, migrate mode).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./types.js";

export class UnknownMigrationError extends Error {
  constructor() {
    super("a recorded migration is missing from this image's migrations folder");
    this.name = "UnknownMigrationError";
  }
}

export class MigrationFailedError extends Error {
  constructor(cause: unknown) {
    super("migration failed", { cause });
    this.name = "MigrationFailedError";
  }
}

/** A-150: a journal file that exists but isn't JSON with an `entries` array. The message never
 * carries the file's content. */
export class JournalInvalidError extends Error {
  constructor() {
    super("drizzle journal is invalid");
    this.name = "JournalInvalidError";
  }
}

// A-376: release tags such as 0001_v0.1.0-hotfix.1 keep their dots and hyphens.
const JOURNAL_TAG = /^[0-9]{4}_[a-z0-9][a-z0-9_.-]*$/;

export function readJournal(
  migrationsFolder: string,
): { tag: string; when: number; hash: string }[] {
  const file = path.join(migrationsFolder, "meta", "_journal.json");
  // No journal means no migrations: the folder holds only .gitkeep until the first release.
  if (!existsSync(file)) return [];
  let entries: unknown;
  try {
    entries = (JSON.parse(readFileSync(file, "utf8")) as { entries?: unknown } | null)?.entries;
  } catch {
    throw new JournalInvalidError();
  }
  if (!Array.isArray(entries)) throw new JournalInvalidError();
  return entries.map((raw: unknown, position) => {
    // A-160: every entry is checked; any failure is the same error, without the file's content.
    const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const { tag, when, idx } = entry;
    if (
      typeof tag !== "string" ||
      !JOURNAL_TAG.test(tag) ||
      typeof when !== "number" ||
      !Number.isSafeInteger(when) ||
      when < 0 ||
      idx !== position
    ) {
      throw new JournalInvalidError();
    }
    let sql: string;
    try {
      sql = readFileSync(path.join(migrationsFolder, `${tag}.sql`), "utf8");
    } catch {
      throw new JournalInvalidError();
    }
    return { tag, when, hash: createHash("sha256").update(sql).digest("hex") };
  });
}

export async function applyCommittedMigrations(
  database: Database,
  migrationsFolder: string,
): Promise<{ applied: number; verified: number }> {
  // A-160: an invalid journal fails before any statement.
  const journal = readJournal(migrationsFolder);
  // A-146: every migrate-mode database has the table, whatever the journal holds. Drizzle's own
  // definition, so its migrator later finds it unchanged.
  await database.handle.executeSql("CREATE SCHEMA IF NOT EXISTS drizzle");
  await database.handle.executeSql(
    "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)",
  );
  const { rows } = await database.handle.executeSql(
    "SELECT hash, created_at FROM drizzle.__drizzle_migrations",
  );
  for (const row of rows) {
    const known = journal.some(
      (entry) => entry.hash === row["hash"] && String(entry.when) === String(row["created_at"]),
    );
    if (!known) throw new UnknownMigrationError();
  }
  const recorded = rows.length;
  if (journal.length === 0) {
    // Drizzle's migrator needs journal entries; with none, there is nothing to apply (A-80, A-146).
    return { applied: 0, verified: recorded };
  }
  try {
    await migrate(drizzle({ client: database.pool }), { migrationsFolder });
  } catch (error) {
    throw new MigrationFailedError(error);
  }
  const after = await database.handle.executeSql(
    "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
  );
  const total = Number.parseInt(String(after.rows[0]?.["n"]), 10);
  return { applied: total - recorded, verified: recorded };
}
