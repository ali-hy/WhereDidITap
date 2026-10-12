// F-6b checkMergeBack (hotfix and infra merge-back check; A-364 adds `kind`). TP-14.9. The fixture project is a throwaway copy of
// the server project with a baseline migration generated from the current schema, plus a hotfix
// migration; F-181's report is injected. Postgres is a container started for this file.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";
import {
  type ServerFixture,
  type StartedPostgres,
  generatePlain,
  serverFixture,
  startPostgres,
} from "../../support/s14.js";

interface CheckMergeBack {
  checkMergeBack: (
    input: {
      serverDir: string;
      kind: "hotfix" | "infra";
      hotfixMigrationFiles: readonly string[];
    },
    deps: {
      startPostgres: () => Promise<StartedPostgres>;
      pendingReport: (input: {
        serverDir: string;
      }) => Promise<{ sql: string; ambiguities: string[] }>;
    },
  ) => Promise<{ ok: boolean; problems: string[] }>;
}

const MODULE = "../../../../../tools/ci/checkMergeBack.ts";
const load = async () => (await import(/* @vite-ignore */ MODULE)) as CheckMergeBack;

let pg: StartedPostgres;
const fixtures: ServerFixture[] = [];

beforeAll(async () => {
  pg = await startPostgres();
}, 180_000);
afterAll(async () => {
  for (const f of fixtures) f.remove();
  await pg.stop();
});

const startShared = () =>
  Promise.resolve({
    superuserUrl: pg.superuserUrl,
    pgDump: pg.pgDump,
    stop: () => Promise.resolve(),
  });

const HOTFIX_OK = 'ALTER TABLE "idempotency_records" ADD COLUMN "hotfix_probe" text;';
const HOTFIX_BAD = 'ALTER TABLE "no_such_table" ADD COLUMN "x" text;';

/** Baseline v0.1.0 generated from the schema, plus hotfix migration 0001 with `sql`. */
function withHotfix(sql: string): { fixture: ServerFixture; file: string } {
  const f = serverFixture();
  fixtures.push(f);
  generatePlain(f.dir, "v0.1.0");
  const name = "0001_v0.1.0-hotfix.1";
  const file = path.join(f.drizzle, `${name}.sql`);
  writeFileSync(file, sql);
  const journalPath = path.join(f.drizzle, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  const first = journal.entries[0];
  if (first === undefined) throw new Error("no baseline journal entry");
  journal.entries.push({ ...first, idx: 1, when: first.when + 1000, tag: name });
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return { fixture: f, file: `apps/server/drizzle/${name}.sql` };
}

describe("TP-14.9: the hotfix merge-back check (F-6b)", () => {
  it("TP-14.9 (a): a hotfix migration that applies and is absent from the pending report is ok", async () => {
    const { checkMergeBack } = await load();
    const { fixture, file } = withHotfix(HOTFIX_OK);

    const result = await checkMergeBack(
      { serverDir: fixture.dir, kind: "hotfix", hotfixMigrationFiles: [file] },
      {
        startPostgres: startShared,
        pendingReport: () => Promise.resolve({ sql: "", ambiguities: [] }),
      },
    );

    expect(result).toEqual({ ok: true, problems: [] });
  }, 300_000);

  it('TP-14.9 (b): a hotfix change still in the pending report (whitespace differs) is the problem "hotfix change still pending: …"', async () => {
    const { checkMergeBack } = await load();
    const { fixture, file } = withHotfix(HOTFIX_OK);
    const pending =
      'CREATE TABLE "x" ("id" int);\n--> statement-breakpoint\nALTER TABLE  "idempotency_records"\n  ADD COLUMN "hotfix_probe" text;';

    const result = await checkMergeBack(
      { serverDir: fixture.dir, kind: "hotfix", hotfixMigrationFiles: [file] },
      {
        startPostgres: startShared,
        pendingReport: () => Promise.resolve({ sql: pending, ambiguities: [] }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([`hotfix change still pending: ${HOTFIX_OK.slice(0, 60)}`]);
  }, 300_000);

  it('TP-14.9 (c): a migration that fails on an empty database is the problem "migrations don\'t apply: <file>"', async () => {
    const { checkMergeBack } = await load();
    const { fixture, file } = withHotfix(HOTFIX_BAD);

    const result = await checkMergeBack(
      { serverDir: fixture.dir, kind: "hotfix", hotfixMigrationFiles: [file] },
      {
        startPostgres: startShared,
        pendingReport: () => Promise.resolve({ sql: "", ambiguities: [] }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.startsWith("migrations don't apply: "))).toBe(true);
  }, 300_000);

  it('TP-14.9 (d) (A-364): an infra merge-back adding a migration is the problem "infra merge-back adds migrations: <files>"', async () => {
    const { checkMergeBack } = await load();
    const { fixture, file } = withHotfix(HOTFIX_OK);

    const result = await checkMergeBack(
      { serverDir: fixture.dir, kind: "infra", hotfixMigrationFiles: [file] },
      {
        startPostgres: startShared,
        pendingReport: () => Promise.resolve({ sql: "", ambiguities: [] }),
      },
    );

    expect(result).toEqual({
      ok: false,
      problems: [`infra merge-back adds migrations: ${file}`],
    });
  }, 300_000);

  it("TP-14.9 (e) (A-364): the CLI with both labels' kinds exits 64 before any check", () => {
    const root = path.resolve(SERVER_DIR, "../..");
    const result = spawnSync(
      path.join(root, "tools/ci/node_modules/.bin/tsx"),
      ["checkMergeBack.ts", "--kind", "hotfix", "--kind", "infra"],
      { cwd: path.join(root, "tools/ci"), encoding: "utf8", timeout: 60_000 },
    );

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(64);
  }, 90_000);
});
