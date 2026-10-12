// F-184 checkRiskyStatements and its CLI. TP-14.5, plus extra cases TP-14.11x. IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";
import { loadCheckRisky } from "../../support/s14.js";

const BREAK = "--> statement-breakpoint";

/** Statements joined the way Drizzle writes them, one per line. */
const migration = (statements: readonly string[]) => statements.join(`${BREAK}\n`);

const FLAGGED: readonly string[] = [
  'DROP TABLE "old_things";',
  'ALTER TABLE "things" DROP COLUMN "note";',
  'ALTER TABLE "things" RENAME COLUMN "a" TO "b";',
  'ALTER TABLE "things" RENAME TO "stuff";',
  'ALTER TABLE "things" ALTER COLUMN "amount" SET DATA TYPE bigint;',
  'ALTER TABLE "things" ALTER COLUMN "amount" TYPE bigint;',
  'ALTER TABLE "things" ALTER COLUMN "name" SET NOT NULL;',
  'ALTER TABLE "things" ADD COLUMN "kind" text NOT NULL;',
  'ALTER TABLE "things" ADD CONSTRAINT "things_amount_positive" CHECK ("amount" > 0);',
  'ALTER TABLE "things" ADD CONSTRAINT "things_owner_fk" FOREIGN KEY ("owner") REFERENCES "users"("id");',
  'CREATE UNIQUE INDEX "things_name_key" ON "things" ("name");',
  'DROP INDEX "things_name_idx";',
  'TRUNCATE "things";',
  'DELETE FROM "things" WHERE "id" = 1;',
  'alter table "things" drop column "lower";',
];

const SAFE: readonly string[] = [
  'CREATE TABLE "new_things" ("id" uuid PRIMARY KEY NOT NULL);',
  'ALTER TABLE "things" ADD COLUMN "kind" text DEFAULT \'a\' NOT NULL;',
  'ALTER TABLE "things" ADD COLUMN "maybe" text;',
  'ALTER TABLE "things" ADD CONSTRAINT "things_check" CHECK ("amount" > 0) NOT VALID;',
  'ALTER TABLE "things" ADD CONSTRAINT "things_fk" FOREIGN KEY ("owner") REFERENCES "users"("id") NOT VALID;',
  'CREATE INDEX "things_name_idx" ON "things" ("name");',
];

describe("TP-14.5: checkRiskyStatements (F-184)", () => {
  it("TP-14.5: each risky pattern is flagged, with the line its statement starts on", async () => {
    const { checkRiskyStatements } = await loadCheckRisky();

    const flagged = checkRiskyStatements(migration(FLAGGED));

    expect(flagged.map((f) => f.line)).toEqual(FLAGGED.map((_s, i) => i + 1));
    for (const f of flagged) expect(f.pattern).not.toBe("");
  });

  it("TP-14.11x: safe statements aren't flagged", async () => {
    const { checkRiskyStatements } = await loadCheckRisky();

    expect(checkRiskyStatements(migration(SAFE))).toEqual([]);
  });

  it("TP-14.5: a statement under -- reviewed: safe because empty table isn't flagged; -- reviewed: x (too short) still is", async () => {
    const { checkRiskyStatements } = await loadCheckRisky();
    const sql = [
      'CREATE TABLE "a" ("id" int);',
      BREAK,
      "-- reviewed: safe because empty table",
      'ALTER TABLE "a" DROP COLUMN "id";',
      BREAK,
      "-- reviewed: x",
      'DROP TABLE "b";',
    ].join("\n");

    const flagged = checkRiskyStatements(sql);

    expect(flagged.map((f) => f.line)).toEqual([7]);
  });

  it("TP-14.5 (A-363): a flagged statement under a 2-line comment block reports its first SQL line (7)", async () => {
    const { checkRiskyStatements } = await loadCheckRisky();
    const sql = [
      'CREATE TABLE "a" ("id" int);',
      BREAK,
      'CREATE TABLE "c" ("id" int);',
      BREAK,
      "-- the old table is no longer read",
      "-- since v1.1.0",
      'DROP TABLE "b";',
    ].join("\n");

    expect(checkRiskyStatements(sql).map((f) => f.line)).toEqual([7]);
  });

  // Review B-5: the reason needs at least 10 characters.
  it.each([
    ["a 9-character reason is still flagged", "123456789", [2]],
    ["an exactly-10-character reason isn't flagged", "1234567890", []],
  ] as const)("TP-14.5: %s", async (_label, reason, lines) => {
    const { checkRiskyStatements } = await loadCheckRisky();
    const sql = [`-- reviewed: ${reason}`, 'DROP TABLE "a";'].join("\n");

    expect(checkRiskyStatements(sql).map((f) => f.line)).toEqual(lines);
  });

  // A-412: a table created earlier in the same file is empty, so its constraints aren't risky.
  it("TP-14.5 (A-412): an FK constraint and a unique index on a table created in the same migration aren't flagged", async () => {
    const { checkRiskyStatements } = await loadCheckRisky();
    const sql = migration([
      'CREATE TABLE "a" ("id" uuid PRIMARY KEY NOT NULL, "owner" uuid NOT NULL, "name" text);',
      'ALTER TABLE "a" ADD CONSTRAINT "a_owner_fk" FOREIGN KEY ("owner") REFERENCES "users"("id");',
      'CREATE UNIQUE INDEX "a_name_key" ON "a" ("name");',
    ]);

    expect(checkRiskyStatements(sql)).toEqual([]);
  });

  it("TP-14.5 (A-412): the same two statements on an existing table b are both flagged", async () => {
    const { checkRiskyStatements } = await loadCheckRisky();
    const sql = migration([
      'CREATE TABLE "a" ("id" uuid PRIMARY KEY NOT NULL);',
      'ALTER TABLE "b" ADD CONSTRAINT "b_owner_fk" FOREIGN KEY ("owner") REFERENCES "users"("id");',
      'CREATE UNIQUE INDEX "b_name_key" ON "b" ("name");',
    ]);

    expect(checkRiskyStatements(sql).map((f) => f.line)).toEqual([2, 3]);
  });

  it("TP-14.12x (A-412): a constraint added before the table's CREATE TABLE in the file is still flagged", async () => {
    const { checkRiskyStatements } = await loadCheckRisky();
    const sql = migration([
      'ALTER TABLE "a" ADD CONSTRAINT "a_check" CHECK ("n" > 0);',
      'CREATE TABLE "a" ("n" int);',
    ]);

    expect(checkRiskyStatements(sql).map((f) => f.line)).toEqual([1]);
  });

  it("TP-14.11x: the review comment covers only the statement right under it", async () => {
    const { checkRiskyStatements } = await loadCheckRisky();
    const sql = [
      "-- reviewed: safe because empty table",
      'DROP TABLE "a";',
      BREAK,
      'DROP TABLE "b";',
    ].join("\n");

    expect(checkRiskyStatements(sql).map((f) => f.line)).toEqual([4]);
  });
});

describe("TP-14.11x: the db:check-risky CLI (F-184)", () => {
  const TSX = path.join(SERVER_DIR, "node_modules/.bin/tsx");

  function cli(files: readonly string[], cwd: string) {
    return spawnSync(TSX, [path.join(SERVER_DIR, "tools/checkRisky.ts"), ...files], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, INIT_CWD: cwd },
    });
  }

  it("TP-14.11x: prints file:line pattern for each flagged statement and exits 1; a clean file exits 0", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-risky-"));
    try {
      writeFileSync(
        path.join(dir, "risky.sql"),
        migration(['CREATE TABLE "a" ("id" int);', 'DROP TABLE "b";']),
      );
      writeFileSync(path.join(dir, "clean.sql"), migration(SAFE));

      const risky = cli(["risky.sql"], dir);
      const clean = cli(["clean.sql"], dir);

      expect(risky.status, risky.stderr).toBe(1);
      expect(`${risky.stdout}${risky.stderr}`).toMatch(/risky\.sql:2 \S/);
      expect(clean.status, clean.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
