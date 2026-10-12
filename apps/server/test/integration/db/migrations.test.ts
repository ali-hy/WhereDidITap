// F-18 applyCommittedMigrations and readJournal. TP-2.13 (fresh container, fixture folder
// test/fixtures/migrations with two migrations; A-80's folder without a journal is
// test/fixtures/migrations-no-journal, holding only `.gitkeep` like apps/server/drizzle), plus extra
// cases TP-2.54x and TP-2.70x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import {
  JournalInvalidError,
  UnknownMigrationError,
  applyCommittedMigrations,
  readJournal,
} from "../../../src/platform/db/migrations.js";
import type { Database } from "../../../src/platform/db/types.js";
import { connectDatabase } from "../../support/platform.js";
import { query, startFreshPostgres, type FreshPostgres } from "../../support/postgres.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/migrations",
);
const NO_JOURNAL = path.resolve(path.dirname(FIXTURE), "migrations-no-journal");
const MISSING_FOLDER = path.resolve(path.dirname(FIXTURE), "migrations-that-do-not-exist");
const EMPTY_JOURNAL = path.resolve(path.dirname(FIXTURE), "migrations-empty");
const MIGRATOR_PASSWORD = "migrations-migrator-password";

// Drizzle's migrate, wrapped in a spy: F-18 calls it only when the journal has entries (A-80, A-146).
vi.mock("drizzle-orm/node-postgres/migrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm/node-postgres/migrator")>();
  return { ...actual, migrate: vi.fn(actual.migrate) };
});
const { migrate: drizzleMigrate } = await import("drizzle-orm/node-postgres/migrator");

beforeEach(() => {
  vi.mocked(drizzleMigrate).mockClear();
});

let pg: FreshPostgres;

beforeAll(async () => {
  pg = await startFreshPostgres();
});

afterAll(async () => {
  await pg.stop();
});

async function freshDatabase(name: string): Promise<Database> {
  const client = await pg.superuserClient();
  try {
    await bootstrapCluster(client, {
      databaseName: name,
      migrator: { password: MIGRATOR_PASSWORD },
    });
  } finally {
    await client.end();
  }
  return connectDatabase(pg, "budmon_migrator", MIGRATOR_PASSWORD, name);
}

function sha256(file: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(FIXTURE, file), "utf8"))
    .digest("hex");
}

describe("TP-2.13: applyCommittedMigrations", () => {
  it("TP-2.13: applies both migrations, then on a second run applies none and verifies both", async () => {
    const database = await freshDatabase("migrate_twice");
    try {
      const first = await applyCommittedMigrations(database, FIXTURE);
      const second = await applyCommittedMigrations(database, FIXTURE);

      expect(first).toMatchObject({ applied: 2 });
      expect(drizzleMigrate).toHaveBeenCalled();
      expect(second).toEqual({ applied: 0, verified: 2 });
      const tables = await query(
        pg.superuserUrl("migrate_twice"),
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      );
      expect(tables).toEqual([{ tablename: "fixture_first" }, { tablename: "fixture_second" }]);
    } finally {
      await database.close();
    }
  });

  it("TP-2.13: a recorded migration that isn't in the folder throws UnknownMigrationError", async () => {
    const database = await freshDatabase("migrate_unknown");
    try {
      await applyCommittedMigrations(database, FIXTURE);
      await database.handle.executeSql(
        "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
        ["0".repeat(64), 1760000200000],
      );

      await expect(applyCommittedMigrations(database, FIXTURE)).rejects.toBeInstanceOf(
        UnknownMigrationError,
      );
    } finally {
      await database.close();
    }
  });
});

async function migrationsRows(databaseName: string): Promise<number | null> {
  const [exists] = await query<{ exists: boolean }>(
    pg.superuserUrl(databaseName),
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists",
  );
  if (exists?.exists !== true) return null;
  const [row] = await query<{ n: string }>(
    pg.superuserUrl(databaseName),
    "SELECT count(*) AS n FROM drizzle.__drizzle_migrations",
  );
  return Number.parseInt(row?.n ?? "0", 10);
}

describe("TP-2.13: a folder without meta/_journal.json means zero migrations (A-80)", () => {
  it("TP-2.13: readJournal returns []", () => {
    expect(readJournal(NO_JOURNAL)).toEqual([]);
  });

  it("TP-2.13: on a fresh database it returns { applied: 0, verified: 0 } without running Drizzle's migrate", async () => {
    const database = await freshDatabase("no_journal_fresh");
    try {
      const report = await applyCommittedMigrations(database, NO_JOURNAL);

      expect(report).toEqual({ applied: 0, verified: 0 });
      expect(drizzleMigrate).not.toHaveBeenCalled();
      // A-146: F-18 creates schema drizzle and an empty table whatever the journal holds.
      expect(await migrationsRows("no_journal_fresh")).toBe(0);
    } finally {
      await database.close();
    }
  });

  it("TP-2.13: on a database with a recorded migration it throws UnknownMigrationError", async () => {
    const database = await freshDatabase("no_journal_recorded");
    try {
      await applyCommittedMigrations(database, FIXTURE);

      await expect(applyCommittedMigrations(database, NO_JOURNAL)).rejects.toBeInstanceOf(
        UnknownMigrationError,
      );
    } finally {
      await database.close();
    }
  });
});

describe("TP-2.13: an existing journal with no entries (A-146)", () => {
  it("TP-2.13: on a fresh database, run twice: { applied: 0, verified: 0 } both times, an empty table after the first, Drizzle's migrate never called", async () => {
    const database = await freshDatabase("empty_journal_twice");
    try {
      const first = await applyCommittedMigrations(database, EMPTY_JOURNAL);
      const rowsAfterFirst = await migrationsRows("empty_journal_twice");
      const second = await applyCommittedMigrations(database, EMPTY_JOURNAL);

      expect(first).toEqual({ applied: 0, verified: 0 });
      expect(rowsAfterFirst).toBe(0);
      expect(second).toEqual({ applied: 0, verified: 0 });
      expect(drizzleMigrate).not.toHaveBeenCalled();
    } finally {
      await database.close();
    }
  });
});

describe("TP-2.13: a malformed journal is an error (A-150)", () => {
  it.each([
    ["{}", "{}"],
    ["not json", "not json CANARYMESSAGE7f3a"],
  ])(
    "TP-2.13: a journal file %s throws JournalInvalidError without its content",
    (_label, content) => {
      const dir = mkdtempSync(path.join(tmpdir(), "budmon-journal-"));
      try {
        mkdirSync(path.join(dir, "meta"));
        writeFileSync(path.join(dir, "meta", "_journal.json"), content);

        let caught: unknown;
        try {
          readJournal(dir);
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(JournalInvalidError);
        expect((caught as Error).message).toBe("drizzle journal is invalid");
        expect((caught as Error).message).not.toContain("CANARY");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  // A-160: a valid entries array with badly shaped entries is invalid too.
  it.each([
    ["a bad tag", { entries: [{ idx: 0, tag: "bad tag", when: 1 }] }, []],
    [
      "a non-integer when",
      { entries: [{ idx: 0, tag: "0000_first", when: "x" }] },
      ["0000_first.sql"],
    ],
    ["a missing .sql file", { entries: [{ idx: 0, tag: "0000_first", when: 1 }] }, []],
    [
      "an idx that isn't its position (extra)",
      { entries: [{ idx: 3, tag: "0000_first", when: 1 }] },
      ["0000_first.sql"],
    ],
  ] as const)(
    "TP-2.13: a journal entry with %s throws JournalInvalidError (A-160)",
    (_label, journal, sqlFiles) => {
      const dir = mkdtempSync(path.join(tmpdir(), "budmon-journal-"));
      try {
        mkdirSync(path.join(dir, "meta"));
        writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal));
        for (const file of sqlFiles) writeFileSync(path.join(dir, file), "SELECT 1;");

        expect(() => readJournal(dir)).toThrow(JournalInvalidError);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  // A-376: tags are ^[0-9]{4}_[a-z0-9][a-z0-9_.-]*$, so F-180's version names are accepted.
  it("TP-2.13 (A-376): tags 0001_v0.1.0 and 0002_v0.1.0-hotfix.1 are accepted", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-journal-"));
    try {
      mkdirSync(path.join(dir, "meta"));
      const tags = ["0001_v0.1.0", "0002_v0.1.0-hotfix.1"];
      writeFileSync(
        path.join(dir, "meta", "_journal.json"),
        JSON.stringify({ entries: tags.map((tag, idx) => ({ idx, tag, when: 1 + idx })) }),
      );
      for (const tag of tags) writeFileSync(path.join(dir, `${tag}.sql`), "SELECT 1;");

      expect(readJournal(dir).map((e) => e.tag)).toEqual(tags);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Each .sql file exists (0005_a/b.sql in a subfolder), so only the pattern can reject the tag.
  it.each([["0003_V1"], ["0004_.x"], ["0005_a/b"]])(
    "TP-2.13 (A-376): tag %s throws JournalInvalidError",
    (tag) => {
      const dir = mkdtempSync(path.join(tmpdir(), "budmon-journal-"));
      try {
        mkdirSync(path.join(dir, "meta"));
        writeFileSync(
          path.join(dir, "meta", "_journal.json"),
          JSON.stringify({ entries: [{ idx: 0, tag, when: 1 }] }),
        );
        const sql = path.join(dir, `${tag}.sql`);
        mkdirSync(path.dirname(sql), { recursive: true });
        writeFileSync(sql, "SELECT 1;");

        expect(() => readJournal(dir)).toThrow(JournalInvalidError);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("TP-2.13: applyCommittedMigrations with a malformed journal throws JournalInvalidError before creating schema drizzle (A-162)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-journal-"));
    const database = await freshDatabase("malformed_journal");
    try {
      mkdirSync(path.join(dir, "meta"));
      writeFileSync(path.join(dir, "meta", "_journal.json"), '{"version":"7"}');

      await expect(applyCommittedMigrations(database, dir)).rejects.toBeInstanceOf(
        JournalInvalidError,
      );
      expect(drizzleMigrate).not.toHaveBeenCalled();
      // A-162: the journal is validated before A-146's CREATE SCHEMA / CREATE TABLE.
      const [namespaces] = await query<{ n: string }>(
        pg.superuserUrl("malformed_journal"),
        "SELECT count(*) AS n FROM pg_namespace WHERE nspname = 'drizzle'",
      );
      expect(namespaces?.n).toBe("0");
    } finally {
      await database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TP-2.70x: a migrations folder that doesn't exist means zero migrations (A-80)", () => {
  it("TP-2.70x: readJournal returns []", () => {
    expect(readJournal(MISSING_FOLDER)).toEqual([]);
  });

  it("TP-2.70x: on a fresh database it returns { applied: 0, verified: 0 } and an empty migrations table (A-146)", async () => {
    const database = await freshDatabase("no_folder_fresh");
    try {
      expect(await applyCommittedMigrations(database, MISSING_FOLDER)).toEqual({
        applied: 0,
        verified: 0,
      });
      expect(drizzleMigrate).not.toHaveBeenCalled();
      expect(await migrationsRows("no_folder_fresh")).toBe(0);
    } finally {
      await database.close();
    }
  });

  it("TP-2.70x: an empty migrations table with no journal is still zero migrations", async () => {
    const database = await freshDatabase("no_journal_empty_table");
    try {
      await applyCommittedMigrations(database, FIXTURE);
      await database.handle.executeSql("DELETE FROM drizzle.__drizzle_migrations");

      expect(await applyCommittedMigrations(database, NO_JOURNAL)).toEqual({
        applied: 0,
        verified: 0,
      });
    } finally {
      await database.close();
    }
  });
});

describe("TP-2.54x: readJournal", () => {
  it("TP-2.54x: lists tag, when and the SHA-256 hex of each migration file", () => {
    expect(readJournal(FIXTURE)).toEqual([
      { tag: "0000_first", when: 1760000000000, hash: sha256("0000_first.sql") },
      { tag: "0001_second", when: 1760000100000, hash: sha256("0001_second.sql") },
    ]);
  });
});
