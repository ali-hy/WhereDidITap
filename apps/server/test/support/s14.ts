// S-14 helpers (test-architect): loaders for the release-migration tools (F-180 to F-182, F-184),
//  and throwaway copies of the server project for drizzle-kit to work in.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { POSTGRES_IMAGE } from "../setup/postgresImage.js";
import { POSTGRES_COMMAND } from "./postgres.js";
import { SERVER_DIR } from "./platform.js";

// ---- Hand-declared shapes (F-180 to F-184) ----

/** F-180's pty process (A-377): a fake in TP-14.1, `scriptPty` in the integration cases. */
export interface PtyProcess {
  onData: (cb: (chunk: string) => void) => void;
  onExit: (cb: (code: number) => void) => void;
  write: (data: string) => void;
  kill: () => void;
}
export type SpawnPty = (
  command: string,
  opts: { cwd: string; cols: number; rows: number },
) => PtyProcess;

export interface ReleaseMigrationModule {
  /** A-377: util-linux script(1) gives the command a real pty; no native module. */
  scriptPty: SpawnPty;
  generateReleaseMigration: (
    input: { version: string; serverDir: string; timeoutMs?: number },
    deps: { spawnPty: SpawnPty },
  ) => Promise<{ file: string | null; ambiguities: string[] }>;
  /** A-361: F-181's deps are `{ spawnPty }`; input takes an optional timeoutMs. */
  pendingSchemaReport: (
    input: { serverDir: string; timeoutMs?: number },
    deps: { spawnPty: SpawnPty },
  ) => Promise<{ sql: string; ambiguities: string[] }>;
}

export interface StartedPostgres {
  superuserUrl: string;
  /** A-378: pg_dump runs inside the POSTGRES_IMAGE container, so client and server match. */
  pgDump: (database: string, args: readonly string[]) => Promise<string>;
  stop: () => Promise<void>;
}

export interface CheckMigrationsModule {
  checkMigrationsReproduceSchema: (
    input: { serverDir: string },
    deps: { startPostgres: () => Promise<StartedPostgres>; spawnPty: SpawnPty },
  ) => Promise<{ ok: boolean; snapshotClean: boolean; dumpDiff: string }>;
}

export interface CheckRiskyModule {
  checkRiskyStatements: (sql: string) => { line: number; pattern: string }[];
}

const TOOLS = "../../tools";

async function load<T>(spec: string): Promise<T> {
  return (await import(/* @vite-ignore */ spec)) as T;
}

export const loadReleaseMigration = () =>
  load<ReleaseMigrationModule>(`${TOOLS}/releaseMigration.ts`);
export const loadCheckMigrations = () => load<CheckMigrationsModule>(`${TOOLS}/checkMigrations.ts`);
export const loadCheckRisky = () => load<CheckRiskyModule>(`${TOOLS}/checkRisky.ts`);

/** F-180's real scriptPty (A-377). */
export async function loadScriptPty(): Promise<SpawnPty> {
  return (await loadReleaseMigration()).scriptPty;
}

// ---- Server project fixtures ----

export interface ServerFixture {
  dir: string;
  drizzle: string;
  remove: () => void;
}

/**
 * A throwaway server project: package.json and drizzle.config.ts copied, node_modules and src
 * linked to the real ones, and an empty drizzle/ folder. drizzle-kit runs in it as in apps/server.
 */
export function serverFixture(parent = tmpdir()): ServerFixture {
  const dir = mkdtempSync(path.join(parent, "budmon-server-fixture-"));
  for (const file of ["package.json", "drizzle.config.ts", "tsconfig.json"]) {
    cpSync(path.join(SERVER_DIR, file), path.join(dir, file));
  }
  symlinkSync(path.join(SERVER_DIR, "node_modules"), path.join(dir, "node_modules"));
  symlinkSync(path.join(SERVER_DIR, "src"), path.join(dir, "src"));
  const drizzle = path.join(dir, "drizzle");
  mkdirSync(drizzle);
  return {
    dir,
    drizzle,
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** `drizzle-kit generate --name <name>` without a pty (fine when no prompt can appear). */
export function generatePlain(dir: string, name: string): string {
  const result = spawnSync(
    path.join(dir, "node_modules/.bin/drizzle-kit"),
    ["generate", "--name", name],
    { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } },
  );
  if (result.status !== 0) {
    throw new Error(`drizzle-kit generate failed: ${result.stdout}${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

/**
 * The server project's baseline release migration as §3.4 has it: drizzle-kit's output with
 * `ALTER TABLE "rate_limit_counters" SET UNLOGGED;` appended (the generator omits it, F-17 sets it in
 * push mode), so migrate mode and push mode build the same schema. Returns the .sql file's path.
 */
export function generateBaseline(dir: string, name: string): string {
  generatePlain(dir, name);
  const drizzle = path.join(dir, "drizzle");
  const file = readdirSync(drizzle).find((n) => n.endsWith(`_${name}.sql`));
  if (file === undefined) throw new Error(`no baseline migration named ${name}`);
  const sqlPath = path.join(drizzle, file);
  const sql = readFileSync(sqlPath, "utf8");
  if (!sql.includes('CREATE TABLE "rate_limit_counters"')) {
    throw new Error("baseline doesn't create rate_limit_counters");
  }
  writeFileSync(
    sqlPath,
    `${sql.trimEnd()}\n--> statement-breakpoint\nALTER TABLE "rate_limit_counters" SET UNLOGGED;\n`,
  );
  return sqlPath;
}

/**
 * A Postgres container for F-182 and F-6b, whose contract hands them a superuser URL (they
 * bootstrap clusters). Started and removed by the test that asks for it.
 */
export async function startPostgres(): Promise<StartedPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand(POSTGRES_COMMAND)
    .start();
  return {
    superuserUrl: container.getConnectionUri(),
    pgDump: async (database, args) => {
      const result = await container.exec([
        "pg_dump",
        "-U",
        container.getUsername(),
        "-d",
        database,
        ...args,
      ]);
      if (result.exitCode !== 0) {
        throw new Error(`pg_dump failed (${String(result.exitCode)}): ${result.stderr}`);
      }
      return result.stdout;
    },
    stop: async () => {
      await container.stop();
    },
  };
}
