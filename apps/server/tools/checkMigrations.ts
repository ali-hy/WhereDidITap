// F-182 checkMigrationsReproduceSchema (check (i)): the committed migrations rebuild exactly the
// schema the code declares, and the snapshot has nothing pending.
//
// CLI (package script `db:check-migrations`): `tsx tools/checkMigrations.ts`. Starts a Postgres
// container (POSTGRES_IMAGE), prints the diff when there is one, exits 0 when ok and 1 otherwise.
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { readJournal } from "../src/platform/db/migrations.js";
import { nodePtySpawn, pendingSchemaReport } from "./releaseMigration.js";
import { buildSchemaDatabase, databaseUrl, startPostgresContainer } from "./schemaDatabase.js";

const run = promisify(execFile);

export interface StartedPostgres {
  superuserUrl: string;
  stop(): Promise<void>;
}

/** `pg_dump --schema-only` of one database, normalised into sorted statements. */
async function dumpSchema(url: string): Promise<string[]> {
  const { stdout } = await run(
    "pg_dump",
    ["--schema-only", "--no-owner", "--no-privileges", "--schema=public", url],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return normaliseDump(stdout);
}

/**
 * Drops comments, blank lines and `SET`/`SELECT pg_catalog.set_config` lines (and psql's
 * `\restrict`/`\unrestrict` meta-commands, whose key is random per dump), then sorts statements.
 */
export function normaliseDump(dump: string): string[] {
  const statements: string[] = [];
  let current: string[] = [];
  for (const raw of dump.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === "" || line.startsWith("--")) continue;
    if (/^SET\s/i.test(line) || /^SELECT pg_catalog\.set_config/i.test(line)) continue;
    if (/^\\(un)?restrict\b/.test(line)) continue;
    current.push(line);
    if (line.endsWith(";")) {
      statements.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length > 0) statements.push(current.join("\n"));
  return statements.sort();
}

/** Statements only in `a` as `- …`, only in `b` as `+ …`; "" when equal. */
function diffStatements(a: readonly string[], b: readonly string[]): string {
  const remaining = [...b];
  const removed: string[] = [];
  for (const s of a) {
    const i = remaining.indexOf(s);
    if (i >= 0) remaining.splice(i, 1);
    else removed.push(s);
  }
  return [
    ...removed.map((s) => `- ${s.replaceAll("\n", "\n  ")}`),
    ...remaining.map((s) => `+ ${s.replaceAll("\n", "\n  ")}`),
  ].join("\n");
}

export async function checkMigrationsReproduceSchema(
  input: { serverDir: string },
  deps: { startPostgres: () => Promise<StartedPostgres> },
): Promise<{ ok: boolean; snapshotClean: boolean; dumpDiff: string }> {
  const migrationsFolder = path.join(input.serverDir, "drizzle");
  // Before the first release there is nothing to check.
  if (readJournal(migrationsFolder).length === 0) {
    return { ok: true, snapshotClean: true, dumpDiff: "" };
  }

  // (a) The snapshot has nothing pending.
  // F-181 with the real node-pty.
  const pending = await pendingSchemaReport(
    { serverDir: input.serverDir },
    { spawnPty: nodePtySpawn },
  );
  const snapshotClean = pending.sql === "";

  // (b) push_ref and from_migrations on one instance, dumped and compared.
  const pg = await deps.startPostgres();
  let dumpDiff: string;
  try {
    await buildSchemaDatabase({
      superuserUrl: pg.superuserUrl,
      name: "push_ref",
      mode: "push",
      migrationsFolder,
    });
    await buildSchemaDatabase({
      superuserUrl: pg.superuserUrl,
      name: "from_migrations",
      mode: "migrate",
      migrationsFolder,
    });
    const pushed = await dumpSchema(databaseUrl(pg.superuserUrl, "push_ref"));
    const migrated = await dumpSchema(databaseUrl(pg.superuserUrl, "from_migrations"));
    dumpDiff = diffStatements(pushed, migrated);
  } finally {
    await pg.stop();
  }
  return { ok: snapshotClean && dumpDiff === "", snapshotClean, dumpDiff };
}

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    const result = await checkMigrationsReproduceSchema(
      { serverDir: SERVER_DIR },
      { startPostgres: startPostgresContainer },
    );
    if (!result.snapshotClean) {
      process.stderr.write("The schema has changes no migration covers (pnpm db:pending-report)\n");
    }
    if (result.dumpDiff !== "") {
      process.stderr.write(`The migrations don't reproduce the schema:\n${result.dumpDiff}\n`);
    }
    if (result.ok) process.stdout.write("checkMigrations: ok\n");
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "failed"}\n`);
    process.exitCode = 1;
  }
}
