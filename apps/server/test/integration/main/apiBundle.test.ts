// The built entries (F-24) under plain Node. TP-2.6: api with DB_HOST unset (F-90, F-11), also
// through the production start command `node --import ./dist/main/instrument.js` (A-147).
// TP-4.24: the built api, started with that command, exports server spans to an OTLP recorder.
// TP-2.37: migrate's failure log on stderr with stdout empty, and on success exactly the report
// line on stdout (F-92, A-81, A-109). Both share one build: two files building into the
// same dist/ in parallel would race. Extra case TP-2.75x; IDs ending in "x" are test-architect
// additions, not LLD test-plan IDs.
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import { runSchemaStep } from "../../../src/platform/db/schemaStep.js";
import { devApi, devWorker, prodWorkerGeneral } from "../../support/configEnv.js";
import { connectDatabase, schemaStepInput } from "../../support/platform.js";
import {
  TEST_ROLE_PASSWORDS,
  query,
  startFreshPostgres,
  type FreshPostgres,
} from "../../support/postgres.js";
import { testApiConfigFor } from "../../support/api.js";
import { jobRows, waitFor, type PgBossLike } from "../../support/jobs.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { createPgBoss } from "../../../src/platform/queue/workers.js";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REPO_ROOT = path.resolve(SERVER_DIR, "../..");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

function portAcceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

beforeAll(() => {
  const build = spawnSync("pnpm", ["--filter", "@budmon/server", "build"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(`pnpm --filter @budmon/server build failed:\n${build.stdout}${build.stderr}`);
  }
}, 180_000);

const START_COMMAND = ["--import", "./dist/main/instrument.js", "dist/main/api.js"];
const START_WORKER = ["--import", "./dist/main/instrument.js", "dist/main/worker.js"];

describe("TP-2.6: node dist/main/api.js with DB_HOST unset", () => {
  it("TP-2.6: through the production start command, the same: exit 78 and the problems (A-147)", async () => {
    const port = await freePort();

    const result = spawnSync(process.execPath, START_COMMAND, {
      cwd: SERVER_DIR,
      env: {
        PATH: process.env["PATH"] ?? "",
        APP_ENV: "development",
        PORT: String(port),
        HOST: "127.0.0.1",
      },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(78);
    expect(result.stderr).toContain("Configuration invalid:");
    expect(result.stderr.split("\n")).toContain("  - DB_HOST: required");
    expect(await portAcceptsConnections(port)).toBe(false);
  });

  it("TP-2.6: prints the configuration problems, exits 78 and opens no port", async () => {
    const port = await freePort();
    const env: Record<string, string> = {
      PATH: process.env["PATH"] ?? "",
      APP_ENV: "development",
      PORT: String(port),
      HOST: "127.0.0.1",
    };

    const result = spawnSync(process.execPath, ["dist/main/api.js"], {
      cwd: SERVER_DIR,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(78);
    expect(result.stderr).toContain("Configuration invalid:");
    expect(result.stderr.split("\n")).toContain("  - DB_HOST: required");
    expect(`${result.stdout}${result.stderr}`).not.toContain("api_started");
    expect(await portAcceptsConnections(port)).toBe(false);
  });
});

// ---- TP-2.37 ----

const MIGRATOR_PASSWORD = "bundle-migrator-Rk4pass";
const WRONG_PASSWORD = "wrong-Zt8pSECRET";
const DATABASE = "budmon_bundle_migrate";
const OK_DATABASE = "budmon_bundle_ok";

describe("TP-2.37: node dist/main/migrate.js failure logs (A-81)", () => {
  let pg: FreshPostgres;
  let dir: string;

  beforeAll(async () => {
    pg = await startFreshPostgres();
    const client = await pg.superuserClient();
    try {
      await bootstrapCluster(client, {
        databaseName: DATABASE,
        migrator: { password: MIGRATOR_PASSWORD },
      });
    } finally {
      await client.end();
    }
    dir = mkdtempSync(path.join(tmpdir(), "budmon-migrate-bundle-"));
  });

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await pg.stop();
  });

  /** A valid development migrate configuration (absolute *_FILE paths) for host and port. */
  function migrateEnv(
    host: string,
    port: number,
    password: string,
    database: string = DATABASE,
  ): Record<string, string> {
    const passwordFile = path.join(dir, `password-${String(port)}`);
    const rolesFile = path.join(dir, "roles.json");
    writeFileSync(passwordFile, `${password}\n`);
    writeFileSync(
      rolesFile,
      JSON.stringify(
        Object.fromEntries(
          ["budmon_app", "budmon_capture", "budmon_queue", "budmon_monitor", "budmon_migrator"].map(
            (role) => [role, { password: role === "budmon_migrator" ? password : `pw-${role}` }],
          ),
        ),
      ),
    );
    return {
      PATH: process.env["PATH"] ?? "",
      APP_ENV: "development",
      DB_HOST: host,
      DB_PORT: String(port),
      DB_NAME: database,
      DB_USER: "budmon_migrator",
      DB_PASSWORD_FILE: passwordFile,
      ROLE_SECRETS_FILE: rolesFile,
    };
  }

  function runMigrateBundle(env: Record<string, string>): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    const result = spawnSync(process.execPath, ["dist/main/migrate.js"], {
      cwd: SERVER_DIR,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  /** Every JSON line of the output whose event is startup_failed. */
  function startupFailures(output: string): Record<string, unknown>[] {
    return output
      .split("\n")
      .flatMap((line): Record<string, unknown>[] => {
        try {
          const parsed: unknown = JSON.parse(line);
          return isRecord(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      })
      .filter((entry) => entry["event"] === "startup_failed");
  }

  function expectNoEndpoint(output: string, host: string, port: number, password: string): void {
    expect(output).not.toContain(password);
    expect(output).not.toContain(host);
    expect(output).not.toMatch(new RegExp(`(?<![0-9])${String(port)}(?![0-9])`));
  }

  it("TP-2.37 (a): a wrong password exits 1 with one startup_failed line carrying errorCode 28P01", () => {
    const env = migrateEnv(pg.host, pg.port, WRONG_PASSWORD);

    const { status, stdout, stderr } = runMigrateBundle(env);
    const output = `${stdout}${stderr}`;

    expect(status, output).toBe(1);
    // A-109: the log goes to stderr; stdout carries only migrate's report, so it's empty here.
    expect(stdout).toBe("");
    const failures = startupFailures(stderr);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.["errorCode"]).toBe("28P01");
    expectNoEndpoint(output, pg.host, pg.port, WRONG_PASSWORD);
  });

  it("TP-2.37 (b): DB_HOST at a closed port exits 1 with one startup_failed line carrying errorCode ECONNREFUSED", async () => {
    const closedPort = await freePort();
    const env = migrateEnv("127.0.0.1", closedPort, MIGRATOR_PASSWORD);

    const { status, stdout, stderr } = runMigrateBundle(env);
    const output = `${stdout}${stderr}`;

    expect(status, output).toBe(1);
    expect(stdout).toBe("");
    const failures = startupFailures(stderr);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.["errorCode"]).toBe("ECONNREFUSED");
    expectNoEndpoint(output, "127.0.0.1", closedPort, MIGRATOR_PASSWORD);
  });

  it('TP-2.37 (A-359): DB_USER=budmon_app exits 1 with one startup_failed line carrying reason "db_user_not_migrator", not [invalid]', () => {
    const env = { ...migrateEnv(pg.host, pg.port, MIGRATOR_PASSWORD), DB_USER: "budmon_app" };

    const { status, stdout, stderr } = runMigrateBundle(env);
    const output = `${stdout}${stderr}`;

    expect(status, output).toBe(1);
    expect(stdout).toBe("");
    const failures = startupFailures(stderr);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.["reason"]).toBe("db_user_not_migrator");
    expect(stderr).not.toContain("[invalid]");
  });

  // The control for (a): with the right password the run gets past authentication. What happens
  // next (the schema step on a bare bootstrapped database) isn't what this case is about.
  it("TP-2.75x: the right password on the same database isn't a 28P01 failure", () => {
    const { stdout, stderr } = runMigrateBundle(migrateEnv(pg.host, pg.port, MIGRATOR_PASSWORD));

    const codes = startupFailures(`${stdout}${stderr}`).map((entry) => entry["errorCode"]);
    expect(codes).not.toContain("28P01");
  });

  // A-109 / F-92 step 4: on success, stdout holds exactly the report line. A database of its own,
  // bootstrapped and pushed (as the global setup does), so migrate mode has everything it needs.
  describe("TP-2.37: on success stdout is exactly the report line (A-109)", () => {
    let okPg: FreshPostgres;

    beforeAll(async () => {
      okPg = await startFreshPostgres();
      const client = await okPg.superuserClient();
      try {
        await bootstrapCluster(client, {
          databaseName: OK_DATABASE,
          migrator: { password: TEST_ROLE_PASSWORDS.budmon_migrator },
        });
      } finally {
        await client.end();
      }
      const migrator = connectDatabase(
        okPg,
        "budmon_migrator",
        TEST_ROLE_PASSWORDS.budmon_migrator,
        OK_DATABASE,
      );
      try {
        await runSchemaStep(schemaStepInput(migrator, "push"));
      } finally {
        await migrator.close();
      }
    });

    afterAll(async () => {
      await okPg.stop();
    });

    it("TP-2.37: exit 0, stdout one JSON report line with zero migrations applied", () => {
      const { status, stdout, stderr } = runMigrateBundle(
        migrateEnv(okPg.host, okPg.port, TEST_ROLE_PASSWORDS.budmon_migrator, OK_DATABASE),
      );

      expect(status, `${stdout}${stderr}`).toBe(0);
      const lines = stdout.split("\n").filter((line) => line !== "");
      expect(lines).toHaveLength(1);
      const report: unknown = JSON.parse(lines[0] ?? "");
      expect(report).toMatchObject({ migrationsApplied: 0 });
      expect(startupFailures(stdout)).toEqual([]);
    });
  });
});

// ---- TP-2.13 (A-150, A-160): migrate exits 5 on an invalid journal ----

describe("TP-2.13: node dist/main/migrate.js with an invalid journal (A-150, A-160)", () => {
  /**
   * A copy of the built server (package.json and dist, node_modules linked) whose drizzle/ holds
   * the given journal and .sql files, so serverRoot()'s drizzle folder is the test's. The database
   * points at a closed port: exit 5 shows the journal was read before any connection.
   */
  async function migrateWith(journal: string, sqlFiles: readonly string[]) {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-migrate-journal-"));
    try {
      writeFileSync(path.join(dir, "package.json"), '{"name":"@budmon/server","type":"module"}\n');
      cpSync(path.join(SERVER_DIR, "dist"), path.join(dir, "dist"), { recursive: true });
      symlinkSync(path.join(SERVER_DIR, "node_modules"), path.join(dir, "node_modules"));
      mkdirSync(path.join(dir, "drizzle", "meta"), { recursive: true });
      writeFileSync(path.join(dir, "drizzle", "meta", "_journal.json"), journal);
      for (const file of sqlFiles) writeFileSync(path.join(dir, "drizzle", file), "SELECT 1;\n");
      const passwordFile = path.join(dir, "password");
      const rolesFile = path.join(dir, "roles.json");
      writeFileSync(passwordFile, "pw\n");
      writeFileSync(
        rolesFile,
        JSON.stringify(
          Object.fromEntries(
            [
              "budmon_app",
              "budmon_capture",
              "budmon_queue",
              "budmon_monitor",
              "budmon_migrator",
            ].map((role) => [role, { password: `pw-${role}` }]),
          ),
        ),
      );
      const port = await freePort();
      return spawnSync(process.execPath, ["dist/main/migrate.js"], {
        cwd: dir,
        env: {
          PATH: process.env["PATH"] ?? "",
          APP_ENV: "development",
          DB_HOST: "127.0.0.1",
          DB_PORT: String(port),
          DB_NAME: "budmon",
          DB_USER: "budmon_migrator",
          DB_PASSWORD_FILE: passwordFile,
          ROLE_SECRETS_FILE: rolesFile,
        },
        encoding: "utf8",
        timeout: 60_000,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    ["{}", "{}", []],
    ["not json", "not json CANARYMESSAGE7f3a", []],
    ["a bad tag", JSON.stringify({ entries: [{ idx: 0, tag: "bad tag", when: 1 }] }), []],
    [
      "a non-integer when",
      JSON.stringify({ entries: [{ idx: 0, tag: "0000_a", when: "x" }] }),
      ["0000_a.sql"],
    ],
    ["a missing .sql file", JSON.stringify({ entries: [{ idx: 0, tag: "0000_a", when: 1 }] }), []],
  ] as const)(
    "TP-2.13: a journal with %s makes migrate exit 5, before touching the database",
    async (_label, journal, sql) => {
      const result = await migrateWith(journal, sql);

      expect(result.status, `${result.stdout}${result.stderr}`).toBe(5);
      expect(`${result.stdout}${result.stderr}`).not.toContain("CANARY");
      expect(`${result.stdout}${result.stderr}`).not.toContain("ECONNREFUSED");
    },
  );
});

// ---- TP-2.15 (d), (e): migrate on a fresh database (A-179, A-204) ----

describe("TP-2.15: node dist/main/migrate.js on a fresh database (A-179)", () => {
  const PASSWORD = "fresh-migrator-Qp7pass";
  const FRESH_DATABASE = "budmon_fresh";
  const started: FreshPostgres[] = [];
  const dirs: string[] = [];

  afterAll(async () => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    for (const pg of started) await pg.stop();
  });

  /** A fresh cluster, bootstrapped (F-15) and nothing else. */
  async function freshCluster(): Promise<FreshPostgres> {
    const pg = await startFreshPostgres();
    started.push(pg);
    const client = await pg.superuserClient();
    try {
      await bootstrapCluster(client, {
        databaseName: FRESH_DATABASE,
        migrator: { password: PASSWORD },
      });
    } finally {
      await client.end();
    }
    return pg;
  }

  /** The built bundle in a temporary directory whose drizzle/ holds `files`, run against pg. */
  function migrateBundle(pg: FreshPostgres, files: Record<string, string>) {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-migrate-fresh-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "package.json"), '{"name":"@budmon/server","type":"module"}\n');
    cpSync(path.join(SERVER_DIR, "dist"), path.join(dir, "dist"), { recursive: true });
    symlinkSync(path.join(SERVER_DIR, "node_modules"), path.join(dir, "node_modules"));
    mkdirSync(path.join(dir, "drizzle", "meta"), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, "drizzle", name), content);
    }
    const passwordFile = path.join(dir, "password");
    const rolesFile = path.join(dir, "roles.json");
    writeFileSync(passwordFile, `${PASSWORD}\n`);
    writeFileSync(
      rolesFile,
      JSON.stringify(
        Object.fromEntries(
          ["budmon_app", "budmon_capture", "budmon_queue", "budmon_monitor", "budmon_migrator"].map(
            (role) => [role, { password: role === "budmon_migrator" ? PASSWORD : `pw-${role}` }],
          ),
        ),
      ),
    );
    return spawnSync(process.execPath, ["dist/main/migrate.js"], {
      cwd: dir,
      env: {
        PATH: process.env["PATH"] ?? "",
        APP_ENV: "development",
        DB_HOST: pg.host,
        DB_PORT: String(pg.port),
        DB_NAME: FRESH_DATABASE,
        DB_USER: "budmon_migrator",
        DB_PASSWORD_FILE: passwordFile,
        ROLE_SECRETS_FILE: rolesFile,
      },
      encoding: "utf8",
      timeout: 60_000,
    });
  }

  function jsonLines(output: string): Record<string, unknown>[] {
    return output.split("\n").flatMap((line): Record<string, unknown>[] => {
      try {
        const parsed: unknown = JSON.parse(line);
        return isJsonObject(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
  }

  it.each([
    ["no journal file", {}],
    ["a journal with entries: []", { "meta/_journal.json": JSON.stringify({ entries: [] }) }],
  ])(
    "TP-2.15 (d): %s exits 0; queue schema installed and queues created, no currencies; schema drizzle granted to budmon_app (A-204)",
    async (_label, files: Record<string, string>) => {
      const pg = await freshCluster();

      const result = migrateBundle(pg, files);

      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      const [reportLine] = jsonLines(result.stdout);
      expect(reportLine).toMatchObject({
        migrationsApplied: 0,
        currenciesUpserted: 0,
        queueSchema: "installed",
      });
      expect(Number(reportLine?.["queuesCreated"])).toBeGreaterThan(0);
      const [drizzle] = await query<{ n: number; usage: boolean }>(
        pg.superuserUrl(FRESH_DATABASE),
        "SELECT count(*)::int AS n, bool_and(has_schema_privilege('budmon_app', oid, 'USAGE')) AS usage FROM pg_namespace WHERE nspname = 'drizzle'",
      );
      expect(drizzle).toEqual({ n: 1, usage: true });
    },
    180_000,
  );

  it("TP-2.15 (e): a one-entry journal whose migration doesn't create currencies exits 3 with table_missing (currencies)", async () => {
    const pg = await freshCluster();

    const result = migrateBundle(pg, {
      "meta/_journal.json": JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          { idx: 0, version: "7", when: 1760000000000, tag: "0000_first", breakpoints: true },
        ],
      }),
      // Creates nothing, so the first listed table checked is absent (no table_without_grants).
      "0000_first.sql": "SELECT 1;\n",
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status, output).toBe(3);
    const failures = jsonLines(result.stderr).filter((l) => l["event"] === "startup_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      errorClass: "SchemaStepError",
      errorCode: "table_missing",
      reason: "currencies",
    });
    expect(output).not.toContain("42P01");
  }, 180_000);
});

// ---- TP-2.13's api half (A-150): the api refuses to start on an invalid journal ----

describe("TP-2.13: node --import ./dist/main/instrument.js dist/main/api.js with an invalid journal (A-150)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase("budmon_app");
  }, 60_000);

  afterAll(async () => {
    await testDb.drop();
  });

  it("TP-2.13: exit 1, one startup_failed line with errorClass JournalInvalidError, no canary, no port", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-api-journal-"));
    try {
      writeFileSync(path.join(dir, "package.json"), '{"name":"@budmon/server","type":"module"}\n');
      cpSync(path.join(SERVER_DIR, "dist"), path.join(dir, "dist"), { recursive: true });
      symlinkSync(path.join(SERVER_DIR, "node_modules"), path.join(dir, "node_modules"));
      mkdirSync(path.join(dir, "drizzle", "meta"), { recursive: true });
      writeFileSync(
        path.join(dir, "drizzle", "meta", "_journal.json"),
        "not json CANARYMESSAGE7f3a",
      );
      const port = await freePort();
      const env = devApiEnvironment(dir, testDb, port);

      const result = spawnSync(process.execPath, START_COMMAND, {
        cwd: dir,
        env,
        encoding: "utf8",
        timeout: 60_000,
      });
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status, output).toBe(1);
      const failures = output
        .split("\n")
        .flatMap((line): Record<string, unknown>[] => {
          try {
            const parsed: unknown = JSON.parse(line);
            return isJsonObject(parsed) ? [parsed] : [];
          } catch {
            return [];
          }
        })
        .filter((r) => r["event"] === "startup_failed");
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ errorClass: "JournalInvalidError" });
      expect(output).not.toContain("CANARY");
      expect(await portAcceptsConnections(port)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A valid development api environment for APP_ENV test: the devApi fixture's secret files written
 * under `dir`, the database `testDb` as budmon_app, and `port`.
 */
function devApiEnvironment(
  dir: string,
  testDb: TestDatabase,
  port: number,
): Record<string, string> {
  const f = devApi();
  const env: Record<string, string> = { PATH: process.env["PATH"] ?? "" };
  for (const [key, value] of Object.entries(f.env)) {
    if (value === undefined) continue;
    const content = f.files.get(value);
    if (content === undefined) {
      env[key] = value;
    } else {
      const file = path.join(dir, path.basename(value));
      writeFileSync(file, content);
      env[key] = file;
    }
  }
  const passwordFile = path.join(dir, "app_password");
  writeFileSync(passwordFile, `${TEST_ROLE_PASSWORDS.budmon_app}\n`);
  return {
    ...env,
    APP_ENV: "test",
    PORT: String(port),
    HOST: "127.0.0.1",
    DB_HOST: testDb.endpoint.host,
    DB_PORT: String(testDb.endpoint.port),
    DB_NAME: testDb.name,
    DB_USER: "budmon_app",
    DB_PASSWORD_FILE: passwordFile,
    OBJECT_STORE_FS_ROOT: path.join(dir, "objects"),
  };
}

// ---- A-225 (S-6 review B-1): a start-up failure after pg-boss started closes the container ----

describe("A-225: a start-up failure after container.boss.start() closes the pool and pg-boss before exit 1 (F-90)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase("budmon_app");
  }, 60_000);

  afterAll(async () => {
    await testDb.drop();
  });

  /** The test database's session counters (pg_stat_database, PostgreSQL 14+). */
  async function sessionCounters(): Promise<{ sessions: number; abandoned: number }> {
    const [row] = await query<{ sessions: string; abandoned: string }>(
      testDb.urlAs("budmon_migrator"),
      "SELECT sessions::text AS sessions, sessions_abandoned::text AS abandoned FROM pg_stat_database WHERE datname = $1",
      [testDb.name],
    );
    return { sessions: Number(row?.sessions ?? 0), abandoned: Number(row?.abandoned ?? 0) };
  }

  it("A-225: listen fails (the port is taken): exit 1 with startup_failed, and every session the api opened ended cleanly (none abandoned)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-api-taken-port-"));
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      const before = await sessionCounters();

      const result = await new Promise<{ code: number | null; output: string }>((resolve) => {
        const child = spawn(process.execPath, START_COMMAND, {
          cwd: SERVER_DIR,
          env: devApiEnvironment(dir, testDb, port),
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (c: Buffer) => (output += c.toString()));
        child.stderr.on("data", (c: Buffer) => (output += c.toString()));
        const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
        child.on("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, output });
        });
      });

      expect(result.code, result.output).toBe(1);
      const failures = result.output
        .split("\n")
        .flatMap((line): Record<string, unknown>[] => {
          try {
            const parsed: unknown = JSON.parse(line);
            return isJsonObject(parsed) ? [parsed] : [];
          } catch {
            return [];
          }
        })
        .filter((l) => l["event"] === "startup_failed");
      expect(failures, result.output).toHaveLength(1);
      expect(failures[0]?.["errorCode"], result.output).toBe("EADDRINUSE");
      // The server records a session's end when its backend exits; give it a moment.
      let after = await sessionCounters();
      for (let i = 0; i < 20 && after.sessions <= before.sessions; i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        after = await sessionCounters();
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      after = await sessionCounters();
      // pg-boss started, so the api had connected; none of those sessions was dropped without
      // the client's Terminate message (pool.end / boss.stop send it; a bare exit doesn't).
      expect(after.sessions, result.output).toBeGreaterThan(before.sessions);
      expect(after.abandoned - before.abandoned, result.output).toBe(0);
    } finally {
      await new Promise<void>((resolve) => {
        blocker.close(() => {
          resolve();
        });
      });
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});

// ---- S-6: the worker process ----

/** The development worker fixture for `roles`, its files written into `dir`, APP_ENV test. */
function devWorkerEnvironment(
  dir: string,
  roles: string,
  db: { host: string; port: number; name: string },
): Record<string, string> {
  const f = devWorker();
  const env: Record<string, string> = { PATH: process.env["PATH"] ?? "" };
  for (const [key, value] of Object.entries(f.env)) {
    if (value === undefined) continue;
    const content = f.files.get(value);
    if (content === undefined) {
      env[key] = value;
    } else {
      const file = path.join(dir, path.basename(value));
      writeFileSync(file, content);
      env[key] = file;
    }
  }
  return {
    ...env,
    APP_ENV: "test",
    WORKER_ROLES: roles,
    // A-299: a capture-only worker connects as budmon_capture.
    ...(roles === "capture" ? { DB_USER: "budmon_capture" } : {}),
    // A-226: a heartbeat file of its own, never /tmp/heartbeat (healthcheck.test.ts reads it).
    HEARTBEAT_FILE: path.join(dir, "heartbeat"),
    DB_HOST: db.host,
    DB_PORT: String(db.port),
    DB_NAME: db.name,
    OBJECT_STORE_FS_ROOT: path.join(dir, "objects"),
  };
}

describe("A-157: the worker's service name follows its roles (F-91)", () => {
  it.each([
    ["general", "worker-general"],
    ["capture", "worker-capture"],
    ["capture,general", "worker"],
  ])(
    "A-157: WORKER_ROLES=%s with the database unreachable: exit 1, startup_failed logged with service %s",
    async (roles, service) => {
      const dir = mkdtempSync(path.join(tmpdir(), "budmon-worker-name-"));
      try {
        const closedPort = await freePort();
        const env = devWorkerEnvironment(dir, roles, {
          host: "127.0.0.1",
          port: closedPort,
          name: "budmon",
        });

        const result = spawnSync(process.execPath, START_WORKER, {
          cwd: SERVER_DIR,
          env,
          encoding: "utf8",
          timeout: 60_000,
        });
        const output = `${result.stdout}${result.stderr}`;

        expect(result.status, output).toBe(1);
        const failures = output
          .split("\n")
          .flatMap((line): Record<string, unknown>[] => {
            try {
              const parsed: unknown = JSON.parse(line);
              return isJsonObject(parsed) ? [parsed] : [];
            } catch {
              return [];
            }
          })
          .filter((l) => l["event"] === "startup_failed");
        expect(failures.length, output).toBeGreaterThanOrEqual(1);
        expect(failures[0]?.["service"], output).toBe(service);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    90_000,
  );
});

describe("TP-6.13, TP-6.15: the built worker with test jobs (fixture worker.mjs, A-201)", () => {
  const FIXTURE = ["--import", "./dist/main/instrument.js", "test/fixtures/bundle/worker.mjs"];
  let testDb: TestDatabase;
  let dir: string;
  let boss: PgBossLike | undefined;

  beforeAll(async () => {
    testDb = await createTestDatabase("budmon_app");
    dir = mkdtempSync(path.join(tmpdir(), "budmon-worker-fixture-"));
    const b = createPgBoss(testApiConfigFor(testDb), "send-only");
    await b.start();
    boss = b;
  }, 60_000);

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await testDb.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  function fixtureEnv(extra: Record<string, string> = {}): Record<string, string> {
    const passwordFile = path.join(dir, "app_password");
    const queuePasswordFile = path.join(dir, "queue_password");
    writeFileSync(passwordFile, `${TEST_ROLE_PASSWORDS.budmon_app}\n`);
    writeFileSync(queuePasswordFile, `${TEST_ROLE_PASSWORDS.budmon_queue}\n`);
    return {
      ...devWorkerEnvironment(dir, "general", {
        host: testDb.endpoint.host,
        port: testDb.endpoint.port,
        name: testDb.name,
      }),
      DB_USER: "budmon_app",
      DB_PASSWORD_FILE: passwordFile,
      QUEUE_DB_USER: "budmon_queue",
      QUEUE_DB_PASSWORD_FILE: queuePasswordFile,
      ...extra,
    };
  }

  let runs = 0;

  /**
   * Spawns the fixture with a HEARTBEAT_FILE of its own (A-226) and resolves once it has logged
   * worker_started (A-161).
   */
  async function startFixture(extra: Record<string, string> = {}) {
    runs += 1;
    const heartbeatFile = path.join(dir, `heartbeat-${String(runs)}`);
    const child = spawn(process.execPath, FIXTURE, {
      cwd: SERVER_DIR,
      env: fixtureEnv({ HEARTBEAT_FILE: heartbeatFile, ...extra }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c: Buffer) => (output += c.toString()));
    child.stderr.on("data", (c: Buffer) => (output += c.toString()));
    const exited = new Promise<{ code: number | null; at: number }>((resolve) => {
      child.on("exit", (code) => {
        resolve({ code, at: Date.now() });
      });
    });
    const deadline = Date.now() + 60_000;
    while (!output.includes('"worker_started"')) {
      if (Date.now() > deadline || child.exitCode !== null) {
        child.kill("SIGKILL");
        throw new Error(`the worker didn't start:\n${output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { child, exited, output: () => output, heartbeatFile };
  }

  async function send(name: string): Promise<string> {
    if (boss === undefined) throw new Error("pg-boss didn't start");
    const id = await boss.send(name, { n: 1 });
    if (id === null) throw new Error("not enqueued");
    return id;
  }

  async function state(name: string, id: string): Promise<string | undefined> {
    return (await jobRows(testDb.database, name)).find((r) => r.id === id)?.state;
  }

  it("TP-6.13: SIGTERM during a 2 s job: the job completes and the process exits 0 within 30 s", async () => {
    const run = await startFixture();
    try {
      const id = await send("test.slow");
      await waitFor(
        async () => (await state("test.slow", id)) === "active",
        30_000,
        "the job to start",
      );

      const sentAt = Date.now();
      run.child.kill("SIGTERM");
      const { code, at } = await run.exited;

      expect(code, run.output()).toBe(0);
      expect(at - sentAt, run.output()).toBeLessThan(30_000);
      expect(await state("test.slow", id)).toBe("completed");
      // A-226: F-79 wrote this run's HEARTBEAT_FILE, with the epoch seconds.
      const beat = Number(readFileSync(run.heartbeatFile, "utf8"));
      expect(Math.abs(Math.floor(Date.now() / 1000) - beat)).toBeLessThan(120);
    } finally {
      if (run.child.exitCode === null) run.child.kill("SIGKILL");
    }
  }, 120_000);

  it("TP-6.13: (A-180) with a job that never finishes, the process exits within 35 s of SIGTERM", async () => {
    const run = await startFixture();
    try {
      const id = await send("test.forever");
      await waitFor(
        async () => (await state("test.forever", id)) === "active",
        30_000,
        "the job to start",
      );

      const sentAt = Date.now();
      run.child.kill("SIGTERM");
      const { at } = await run.exited;

      expect(at - sentAt, run.output()).toBeLessThan(35_500);
    } finally {
      if (run.child.exitCode === null) run.child.kill("SIGKILL");
    }
  }, 120_000);

  it("TP-6.15: (A-237) a job lifecycle of 25 jobs (completing, retrying, dead-lettering): every pg.query name is pg.query:<KEYWORD>[ <database>], none is span, and no unexpected drop is counted", async () => {
    const received: OtlpRequest[] = [];
    const recorder = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        let body: unknown = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          body = null;
        }
        received.push({ path: req.url ?? "", body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => recorder.listen(0, "127.0.0.1", resolve));
    const address = recorder.address();
    const recorderPort = typeof address === "object" && address !== null ? address.port : 0;
    const run = await startFixture({
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${String(recorderPort)}`,
    });
    try {
      const ids = { ok: [] as string[], retry: [] as string[], dead: [] as string[] };
      for (let i = 0; i < 10; i++) ids.ok.push(await send("test.ok"));
      for (let i = 0; i < 8; i++) ids.retry.push(await send("test.fail3"));
      for (let i = 0; i < 7; i++) ids.dead.push(await send("test.fail"));

      const states = async (name: string, wanted: readonly string[]) =>
        (await jobRows(testDb.database, name)).filter((r) => wanted.includes(r.id));
      await waitFor(
        async () => {
          const ok = await states("test.ok", ids.ok);
          const retried = await states("test.fail3", ids.retry);
          const dead = await states("test.fail", ids.dead);
          return (
            ok.every((r) => r.state === "completed") &&
            retried.every((r) => r.state === "completed") &&
            dead.every((r) => r.state === "failed") &&
            (await jobRows(testDb.database, "dead-letter.general")).length >= 7
          );
        },
        90_000,
        "the 25 jobs to settle",
      );
      run.child.kill("SIGTERM");
      await run.exited;

      const all = exportedSpans(received);
      const pgQueries = all.filter(
        (s) => s.scope === "@opentelemetry/instrumentation-pg" && s.name.startsWith("pg.query"),
      );
      const seen = JSON.stringify([...new Set(pgQueries.map((s) => s.name))]);
      expect(pgQueries.length, seen).toBeGreaterThan(0);
      for (const span of pgQueries) {
        expect(span.name, seen).toMatch(/^pg\.query:[A-Z]+( [a-z0-9_]+)?$/);
      }
      expect(all.filter((s) => s.name === "span").map((s) => s.scope)).toEqual([]);
      expect(unexpectedDrops(received).filter((v) => v > 0)).toEqual([]);
    } finally {
      if (run.child.exitCode === null) run.child.kill("SIGKILL");
      await new Promise<void>((resolve) => {
        recorder.close(() => {
          resolve();
        });
      });
    }
  }, 180_000);

  it("TP-6.15: through the start command, the recorder gets a pg span (SELECT) whose parent is pg-boss's CONSUMER span process test.select (A-219)", async () => {
    const received: OtlpRequest[] = [];
    const recorder = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        let body: unknown = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          body = null;
        }
        received.push({ path: req.url ?? "", body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => recorder.listen(0, "127.0.0.1", resolve));
    const address = recorder.address();
    const recorderPort = typeof address === "object" && address !== null ? address.port : 0;
    const run = await startFixture({
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${String(recorderPort)}`,
    });
    try {
      const id = await send("test.select");
      await waitFor(
        async () => (await state("test.select", id)) === "completed",
        30_000,
        "the job to complete",
      );
      run.child.kill("SIGTERM");
      await run.exited;

      const all = exportedSpans(received);
      const seen = JSON.stringify(all.map((s) => [s.scope, s.name, s.attributes["db.query.text"]]));
      const selects = all.filter(
        (s) =>
          s.scope === "@opentelemetry/instrumentation-pg" &&
          s.attributes["db.query.text"] === "SELECT ?",
      );
      expect(selects.length, seen).toBeGreaterThanOrEqual(1);
      const byId = new Map(all.map((s) => [s.spanId, s]));
      const parents = selects.map((s) => byId.get(s.parentSpanId));
      // A-219: the job's span is pg-boss's CONSUMER span "process <queue>".
      expect(
        parents.some(
          (p) =>
            p !== undefined && p.kind === SPAN_KIND_CONSUMER && p.name === "process test.select",
        ),
        seen,
      ).toBe(true);
    } finally {
      if (run.child.exitCode === null) run.child.kill("SIGKILL");
      await new Promise<void>((resolve) => {
        recorder.close(() => {
          resolve();
        });
      });
    }
  }, 120_000);
});

// ---- TP-4.24 ----

interface OtlpRequest {
  path: string;
  body: unknown;
}

interface ExportedSpan {
  scope: string;
  kind: number;
  name: string;
  spanId: string;
  parentSpanId: string;
  attributes: Record<string, unknown>;
}

/** Every span in the recorded OTLP/HTTP JSON trace exports. */
function exportedSpans(requests: readonly OtlpRequest[]): ExportedSpan[] {
  const spans: ExportedSpan[] = [];
  for (const r of requests.filter((x) => x.path.endsWith("/v1/traces"))) {
    const body = r.body as {
      resourceSpans?: {
        scopeSpans?: {
          scope?: { name?: string };
          spans?: {
            kind?: number;
            name?: string;
            spanId?: string;
            parentSpanId?: string;
            attributes?: { key: string; value: Record<string, unknown> }[];
          }[];
        }[];
      }[];
    };
    for (const rs of body.resourceSpans ?? []) {
      for (const ss of rs.scopeSpans ?? []) {
        for (const span of ss.spans ?? []) {
          spans.push({
            scope: ss.scope?.name ?? "",
            kind: span.kind ?? 0,
            name: span.name ?? "",
            spanId: span.spanId ?? "",
            parentSpanId: span.parentSpanId ?? "",
            attributes: Object.fromEntries(
              (span.attributes ?? []).map((a) => [a.key, Object.values(a.value)[0]]),
            ),
          });
        }
      }
    }
  }
  return spans;
}

/** Whether `ancestorId` is on `span`'s parent chain. */
function hasAncestor(
  span: ExportedSpan,
  ancestorId: string,
  all: readonly ExportedSpan[],
): boolean {
  const byId = new Map(all.map((s) => [s.spanId, s]));
  let current: ExportedSpan | undefined = span;
  for (let i = 0; i < 50 && current !== undefined; i++) {
    if (current.parentSpanId === ancestorId) return true;
    current = byId.get(current.parentSpanId);
  }
  return false;
}

/** The recorded values of telemetry_attributes_dropped_total with drop_kind "unexpected". */
function unexpectedDrops(requests: readonly OtlpRequest[]): number[] {
  const values: number[] = [];
  for (const r of requests.filter((x) => x.path.endsWith("/v1/metrics"))) {
    const body = r.body as {
      resourceMetrics?: {
        scopeMetrics?: {
          metrics?: {
            name?: string;
            sum?: {
              dataPoints?: {
                asInt?: number | string;
                asDouble?: number;
                attributes?: { key: string; value: Record<string, unknown> }[];
              }[];
            };
          }[];
        }[];
      }[];
    };
    for (const rm of body.resourceMetrics ?? []) {
      for (const sm of rm.scopeMetrics ?? []) {
        for (const m of sm.metrics ?? []) {
          if (m.name !== "telemetry_attributes_dropped_total") continue;
          for (const p of m.sum?.dataPoints ?? []) {
            const kind = (p.attributes ?? []).find((a) => a.key === "drop_kind");
            if (kind !== undefined && Object.values(kind.value)[0] === "unexpected") {
              values.push(Number(p.asInt ?? p.asDouble ?? 0));
            }
          }
        }
      }
    }
  }
  return values;
}

const SPAN_KIND_SERVER = 2;
const SPAN_KIND_CONSUMER = 5;

/** The attributes of every recorded data point of the metric `name` (any point type). */
function metricPointAttributes(
  requests: readonly OtlpRequest[],
  name: string,
): Record<string, unknown>[] {
  type Point = { attributes?: { key: string; value: Record<string, unknown> }[] };
  const out: Record<string, unknown>[] = [];
  for (const r of requests.filter((x) => x.path.endsWith("/v1/metrics"))) {
    const body = r.body as {
      resourceMetrics?: {
        scopeMetrics?: {
          metrics?: {
            name?: string;
            sum?: { dataPoints?: Point[] };
            gauge?: { dataPoints?: Point[] };
            histogram?: { dataPoints?: Point[] };
          }[];
        }[];
      }[];
    };
    for (const rm of body.resourceMetrics ?? []) {
      for (const sm of rm.scopeMetrics ?? []) {
        for (const m of sm.metrics ?? []) {
          if (m.name !== name) continue;
          const points = [
            ...(m.sum?.dataPoints ?? []),
            ...(m.gauge?.dataPoints ?? []),
            ...(m.histogram?.dataPoints ?? []),
          ];
          for (const p of points) {
            out.push(
              Object.fromEntries(
                (p.attributes ?? []).map((a) => [a.key, Object.values(a.value)[0]]),
              ),
            );
          }
        }
      }
    }
  }
  return out;
}

/** Writes `text` to 127.0.0.1:port over a raw socket; resolves with what came back once closed. */
function rawHttp(port: number, text: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let received = "";
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(text);
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (received += chunk));
    socket.on("end", () => {
      resolve(received);
    });
    socket.on("error", reject);
  });
}

describe("TP-4.24: the built api exports spans through the production start command (A-147)", () => {
  let recorder: Server;
  let recorderPort: number;
  const received: OtlpRequest[] = [];
  let testDb: TestDatabase;
  let configDir: string;

  beforeAll(async () => {
    recorder = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: unknown = null;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
        received.push({ path: req.url ?? "", body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => recorder.listen(0, "127.0.0.1", resolve));
    const address = recorder.address();
    recorderPort = typeof address === "object" && address !== null ? address.port : 0;
    testDb = await createTestDatabase("budmon_app");
    configDir = mkdtempSync(path.join(tmpdir(), "budmon-api-otel-"));
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      recorder.close(() => {
        resolve();
      });
    });
    await testDb.drop();
    rmSync(configDir, { recursive: true, force: true });
  });

  /** The development api fixture, with its secret files written to configDir, for APP_ENV test. */
  function apiEnv(port: number): Record<string, string> {
    const f = devApi();
    const env: Record<string, string> = { PATH: process.env["PATH"] ?? "" };
    for (const [key, value] of Object.entries(f.env)) {
      if (value === undefined) continue;
      const content = f.files.get(value);
      if (content === undefined) {
        env[key] = value;
      } else {
        const file = path.join(configDir, path.basename(value));
        writeFileSync(file, content);
        env[key] = file;
      }
    }
    const passwordFile = path.join(configDir, "app_password");
    writeFileSync(passwordFile, `${TEST_ROLE_PASSWORDS.budmon_app}\n`);
    return {
      ...env,
      APP_ENV: "test",
      PORT: String(port),
      HOST: "127.0.0.1",
      DB_HOST: testDb.endpoint.host,
      DB_PORT: String(testDb.endpoint.port),
      DB_NAME: testDb.name,
      DB_USER: "budmon_app",
      DB_PASSWORD_FILE: passwordFile,
      OBJECT_STORE_FS_ROOT: path.join(configDir, "objects"),
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${String(recorderPort)}`,
    };
  }

  /** Starts the built api with `args`, makes one request (after `before`), stops it with SIGTERM. */
  async function runApi(
    args: readonly string[],
    before?: (port: number) => Promise<void>,
  ): Promise<{ status: number; code: number | null; output: string }> {
    const port = await freePort();
    const child = spawn(process.execPath, args, {
      cwd: SERVER_DIR,
      env: apiEnv(port),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c: Buffer) => (output += c.toString()));
    child.stderr.on("data", (c: Buffer) => (output += c.toString()));
    const exited = new Promise<number | null>((resolve) => {
      child.on("exit", (code) => {
        resolve(code);
      });
    });
    try {
      const deadline = Date.now() + 30_000;
      while (!(await portAcceptsConnections(port))) {
        if (Date.now() > deadline || child.exitCode !== null) {
          throw new Error(`the api didn't start:\n${output}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (before !== undefined) await before(port);
      const res = await fetch(`http://127.0.0.1:${String(port)}/api/v1/meta/client-config`);
      await res.text();
      child.kill("SIGTERM");
      return { status: res.status, code: await exited, output };
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }

  it("TP-4.24: with --import, one http SERVER span GET /api/v1/*, @fastify/otel's request under it, hooks named by hook, no unexpected drops, metrics (A-163, A-164)", async () => {
    received.length = 0;

    const run = await runApi(START_COMMAND);

    expect(run.status, run.output).toBe(200);
    const all = exportedSpans(received);
    const seen = JSON.stringify(all.map((s) => [s.scope, s.kind, s.name]));
    const servers = all.filter(
      (s) => s.kind === SPAN_KIND_SERVER && s.scope === "@opentelemetry/instrumentation-http",
    );
    expect(servers, seen).toHaveLength(1);
    const server = servers[0];
    // `GET /api/v1/*` until A-186 (S-5) names it after the route template; the A-186 case pins it.
    expect(server?.name).toMatch(/^GET \/api\/v1\//);
    const fastify = all.filter((s) => s.scope === "@fastify/otel");
    const requests = fastify.filter((s) => s.name === "request");
    expect(requests.length, seen).toBeGreaterThanOrEqual(1);
    expect(
      requests.some((s) => hasAncestor(s, server?.spanId ?? "", all)),
      seen,
    ).toBe(true);
    for (const span of fastify) expect(span.name, seen).toMatch(/^[A-Za-z]+$/);
    expect(
      all.filter((s) => s.name === "span"),
      seen,
    ).toEqual([]);
    expect(unexpectedDrops(received).filter((v) => v > 0)).toEqual([]);
    expect(received.some((r) => r.path.endsWith("/v1/metrics"))).toBe(true);
  }, 90_000);

  it("TP-4.24: canaries in the path, Host and X-Forwarded-Host reach no span or metric; no url.path; SERVER spans have no server.address/port; client-config has budmon.route (A-176, A-177)", async () => {
    received.length = 0;
    let canaryResponse = "";

    const run = await runApi(START_COMMAND, async (port) => {
      canaryResponse = await rawHttp(
        port,
        [
          `GET /api/v1/${CANARIES.payee}/${CANARIES.amountMinor}/canary.7f3a%40example.invalid HTTP/1.1`,
          `Host: ${CANARIES.payee}.example.invalid:${CANARIES.amountMinor}`,
          "X-Forwarded-Host: canary.7f3a.example.invalid",
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
    });

    expect(run.status, run.output).toBe(200);
    expect(canaryResponse).toMatch(/^HTTP\/1\.1 404/);
    const all = exportedSpans(received);
    const seen = JSON.stringify(all.map((s) => [s.scope, s.kind, s.name, s.attributes]));
    // Both requests were traced: the canary one and client-config.
    expect(all.filter((s) => s.kind === SPAN_KIND_SERVER).length, seen).toBeGreaterThanOrEqual(2);
    expect(
      scanForCanaries(
        received.map((r, i) => ({ name: `${r.path}#${String(i)}`, text: JSON.stringify(r.body) })),
        CANARIES,
      ),
    ).toEqual([]);
    expect(JSON.stringify(received.map((r) => r.body))).not.toContain("canary.7f3a.example");
    for (const span of all) expect(Object.keys(span.attributes), seen).not.toContain("url.path");
    for (const span of all.filter((s) => s.kind === SPAN_KIND_SERVER)) {
      expect(Object.keys(span.attributes), seen).not.toContain("server.address");
      expect(Object.keys(span.attributes), seen).not.toContain("server.port");
    }
    expect(
      all.filter((s) => s.attributes["budmon.route"] === "/meta/client-config").length,
      seen,
    ).toBeGreaterThanOrEqual(1);
  }, 90_000);

  // TP-4.29 (A-180). The bundle has no test procedure, so the stalled request is one whose body
  // never finishes: it stays in flight, and app.close() can't complete on its own.
  it("TP-4.29: with an OTLP endpoint that never answers and a stalled request, SIGTERM exits 0 within 8.5 s", async () => {
    const sockets: Socket[] = [];
    const blackHole = createServer((socket) => {
      sockets.push(socket); // accepted, never answered
    });
    await new Promise<void>((resolve) => blackHole.listen(0, "127.0.0.1", resolve));
    const address = blackHole.address();
    const blackHolePort = typeof address === "object" && address !== null ? address.port : 0;
    const port = await freePort();
    const child = spawn(process.execPath, START_COMMAND, {
      cwd: SERVER_DIR,
      env: {
        ...apiEnv(port),
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${String(blackHolePort)}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c: Buffer) => (output += c.toString()));
    child.stderr.on("data", (c: Buffer) => (output += c.toString()));
    const exited = new Promise<{ code: number | null; at: number }>((resolve) => {
      child.on("exit", (code) => {
        resolve({ code, at: Date.now() });
      });
    });
    let stalled: Socket | undefined;
    try {
      const deadline = Date.now() + 30_000;
      while (!(await portAcceptsConnections(port))) {
        if (Date.now() > deadline || child.exitCode !== null) {
          throw new Error(`the api didn't start:\n${output}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      // Telemetry to flush: one completed request.
      await (await fetch(`http://127.0.0.1:${String(port)}/api/v1/meta/client-config`)).text();
      const socket = await new Promise<Socket>((resolve, reject) => {
        const s = createConnection({ host: "127.0.0.1", port }, () => {
          resolve(s);
        });
        s.once("error", reject);
      });
      stalled = socket;
      socket.write(
        [
          "POST /api/v1/test/stalled HTTP/1.1",
          "Host: 127.0.0.1",
          "Content-Type: application/json",
          "Content-Length: 1000",
          "",
          '{"a":',
        ].join("\r\n"),
      );
      await new Promise((resolve) => setTimeout(resolve, 500));

      const sentAt = Date.now();
      child.kill("SIGTERM");
      const { code, at } = await exited;

      expect(code, output).toBe(0);
      expect(at - sentAt, output).toBeLessThan(8_500);
      // The exporter did reach the endpoint that never answers.
      expect(sockets.length).toBeGreaterThan(0);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      stalled?.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        blackHole.close(() => {
          resolve();
        });
      });
    }
  }, 90_000);

  it("TP-4.24: (A-186) the SERVER span and http.route are the procedure template; an unmatched request stays GET /api/v1/*", async () => {
    received.length = 0;

    const run = await runApi(START_COMMAND, async (port) => {
      await (await fetch(`http://127.0.0.1:${String(port)}/api/v1/nope`)).text();
    });

    expect(run.status, run.output).toBe(200);
    const servers = exportedSpans(received).filter(
      (s) => s.kind === SPAN_KIND_SERVER && s.scope === "@opentelemetry/instrumentation-http",
    );
    const seen = JSON.stringify(servers.map((s) => [s.name, s.attributes["http.route"]]));
    expect(servers, seen).toHaveLength(2);
    expect(
      servers.filter(
        (s) =>
          s.name === "GET /api/v1/meta/client-config" &&
          s.attributes["http.route"] === "/api/v1/meta/client-config",
      ),
      seen,
    ).toHaveLength(1);
    expect(
      servers.filter((s) => s.name === "GET /api/v1/*"),
      seen,
    ).toHaveLength(1);
    const routes = metricPointAttributes(received, "http.server.request.duration").map(
      (a) => a["http.route"],
    );
    expect(routes, JSON.stringify(routes)).toContain("/api/v1/meta/client-config");
  }, 90_000);

  it("TP-4.24: without --import, no server span arrives (guards the start command)", async () => {
    received.length = 0;

    const run = await runApi(["dist/main/api.js"]);

    expect(run.status, run.output).toBe(200);
    expect(exportedSpans(received).filter((s) => s.kind === SPAN_KIND_SERVER)).toEqual([]);
  }, 90_000);
});

// TP-15.25 (integration part, F-11, F-191): the built worker refuses a placeholder secret file.
describe("TP-15.25: node dist/main/worker.js with an unfilled placeholder file", () => {
  it("TP-15.25: S3_ACCESS_KEY_ID_FILE holding __FILL_ME__ exits non-zero with the placeholder line on stderr, without the value", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-placeholder-"));
    try {
      const f = prodWorkerGeneral();
      const env: Record<string, string> = { PATH: process.env["PATH"] ?? "" };
      for (const [key, value] of Object.entries(f.env)) {
        if (value === undefined) continue;
        const content = f.files.get(value);
        if (content === undefined) {
          env[key] = value;
        } else {
          const file = path.join(dir, key.toLowerCase());
          writeFileSync(file, key === "S3_ACCESS_KEY_ID_FILE" ? "__FILL_ME__\n" : content);
          env[key] = file;
        }
      }

      const result = spawnSync(
        process.execPath,
        ["--import", "./dist/main/instrument.js", "dist/main/worker.js"],
        { cwd: SERVER_DIR, env, encoding: "utf8", timeout: 60_000 },
      );

      expect(result.status).not.toBe(0);
      // A-389: the problem names the variable that was set.
      expect(result.stderr).toContain("S3_ACCESS_KEY_ID_FILE: placeholder not filled");
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/__FILL_ME__/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
