// F-182 checkMigrationsReproduceSchema (check (i)). TP-14.4. Fixture projects are throwaway copies of
// the server project (support/s14.ts) whose drizzle/ folder is built per case; Postgres is a
// container started for this file (F-182 bootstraps clusters, so its contract takes a superuser).
// A-378: pg_dump runs inside that container (the handle's pgDump), so client and server match.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ServerFixture,
  type SpawnPty,
  type StartedPostgres,
  generateBaseline,
  loadCheckMigrations,
  loadScriptPty,
  serverFixture,
  startPostgres,
} from "../../support/s14.js";

let pg: StartedPostgres;
const fixtures: ServerFixture[] = [];

beforeAll(async () => {
  pg = await startPostgres();
}, 180_000);
afterAll(async () => {
  for (const f of fixtures) f.remove();
  await pg.stop();
});

/** Every pgDump output the check received, to inspect the normalised comparison (A-379). */
const dumps: string[] = [];

/**
 * startPostgres hands out the file's container; F-182 may stop it, which this ignores. pgDump adds
 * pg_dump 18's `\restrict <key>` / `\unrestrict <key>` lines with a fresh key per call whether or
 * not the server's pg_dump wrote them, so a clean result shows they're stripped (A-379).
 */
const deps = {
  startPostgres: () =>
    Promise.resolve({
      superuserUrl: pg.superuserUrl,
      pgDump: async (database: string, args: readonly string[]) => {
        const key = Math.random().toString(36).slice(2);
        const dump = `\\restrict ${key}\n${await pg.pgDump(database, args)}\n\\unrestrict ${key}\n`;
        dumps.push(dump);
        return dump;
      },
      stop: () => Promise.resolve(),
    }),
  spawnPty: (...args: Parameters<SpawnPty>) => spawnPty(...args),
};

let spawnPty: SpawnPty;
beforeAll(async () => {
  spawnPty = await loadScriptPty();
});

function fixtureWithBaseline(): ServerFixture {
  const f = serverFixture();
  fixtures.push(f);
  generateBaseline(f.dir, "v0.1.0");
  return f;
}

const sqlFile = (f: ServerFixture) => {
  const name = readdirSync(f.drizzle).find((n) => n.endsWith(".sql"));
  if (name === undefined) throw new Error("no migration generated");
  return path.join(f.drizzle, name);
};

describe("TP-14.4: migrations reproduce the schema (F-182)", () => {
  it("TP-14.4: migrations generated from the current schema: ok, snapshotClean, no diff", async () => {
    const { checkMigrationsReproduceSchema } = await loadCheckMigrations();
    const f = fixtureWithBaseline();

    const before = dumps.length;

    expect(await checkMigrationsReproduceSchema({ serverDir: f.dir }, deps)).toEqual({
      ok: true,
      snapshotClean: true,
      dumpDiff: "",
    });
    // A-378: both schemas were dumped through the container's pg_dump, each with its own
    // \restrict key, and the comparison still found no difference (A-379).
    expect(dumps.length - before).toBeGreaterThanOrEqual(2);
  }, 300_000);

  it("TP-14.4: a migration missing a column: not ok, and dumpDiff mentions the column", async () => {
    const { checkMigrationsReproduceSchema } = await loadCheckMigrations();
    const f = fixtureWithBaseline();
    const file = sqlFile(f);
    // Drop idempotency_records.response_status from the migration only (the snapshot keeps it).
    const sql = readFileSync(file, "utf8");
    const edited = sql.replace(/\n\t"response_status" smallint,/, "");
    expect(edited).not.toBe(sql);
    writeFileSync(file, edited);

    const result = await checkMigrationsReproduceSchema({ serverDir: f.dir }, deps);

    expect(result.ok).toBe(false);
    expect(result.snapshotClean).toBe(true);
    expect(result.dumpDiff).toMatch(/response_status/);
    // A-379: the normalised dumps carry no \restrict or \unrestrict line.
    expect(result.dumpDiff).not.toMatch(/^[-+ ]?\\(un)?restrict\b/m);
  }, 300_000);

  it("TP-14.4: a stale snapshot: snapshotClean false and not ok", async () => {
    const { checkMigrationsReproduceSchema } = await loadCheckMigrations();
    const f = fixtureWithBaseline();
    const snapshot = path.join(f.drizzle, "meta/0000_snapshot.json");
    const json = JSON.parse(readFileSync(snapshot, "utf8")) as {
      tables: Record<string, { columns: Record<string, unknown> }>;
    };
    const records = json.tables["public.idempotency_records"];
    if (records === undefined) throw new Error("no public.idempotency_records in the snapshot");
    Reflect.deleteProperty(records.columns, "response_status");
    writeFileSync(snapshot, JSON.stringify(json, null, 2));

    const result = await checkMigrationsReproduceSchema({ serverDir: f.dir }, deps);

    expect(result.snapshotClean).toBe(false);
    expect(result.ok).toBe(false);
  }, 300_000);

  it("TP-14.4: no migrations at all: ok, snapshotClean, no diff, without starting Postgres", async () => {
    const { checkMigrationsReproduceSchema } = await loadCheckMigrations();
    const f = serverFixture();
    fixtures.push(f);
    let started = 0;

    const result = await checkMigrationsReproduceSchema(
      { serverDir: f.dir },
      {
        startPostgres: () => {
          started += 1;
          return deps.startPostgres();
        },
        spawnPty: deps.spawnPty,
      },
    );

    expect(result).toEqual({ ok: true, snapshotClean: true, dumpDiff: "" });
    expect(started).toBe(0);
  }, 120_000);
});
