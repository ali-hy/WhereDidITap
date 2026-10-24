// Worker configuration and containers on a test database (S-6), owned by the test-architect.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../../src/platform/config/loadConfig.js";
import type { Config } from "../../src/platform/config/schema.js";
import { createWorkerContainer } from "../../src/platform/container.js";
import { observed, type Observed } from "./api.js";
import { devWorker, readFileFrom, withFile } from "./configEnv.js";
import type { WorkerContainer } from "./jobs.js";
import { TEST_ROLE_PASSWORDS, type Endpoint } from "./postgres.js";
import { createTestDatabase, type TestDatabase } from "./testDatabase.js";

export type RolesSpec = "general" | "capture" | "capture,general";

/**
 * A development worker configuration (F-10, kind `worker`) for `roles`, connected to `database`
 * at `endpoint`: `DB_USER` is `budmon_capture` for a capture-only worker, else `budmon_app`; the
 * queue login (general) is `budmon_queue`; passwords are the test roles'.
 */
export function testWorkerConfig(
  endpoint: Endpoint,
  database: string,
  roles: RolesSpec,
  env: Record<string, string | undefined> = {},
  files: Record<string, string> = {},
): Config {
  const f = devWorker();
  // Secret-file variables given their content (e.g. CAPTURE_PUBLIC_KEY_FILE).
  for (const [variable, content] of Object.entries(files)) withFile(f, variable, content);
  const dbUser = roles === "capture" ? "budmon_capture" : "budmon_app";
  Object.assign(f.env, {
    WORKER_ROLES: roles,
    APP_ENV: "test",
    DB_HOST: endpoint.host,
    DB_PORT: String(endpoint.port),
    DB_NAME: database,
    DB_USER: dbUser,
    QUEUE_DB_USER: "budmon_queue",
    ...env,
  });
  withFile(f, "DB_PASSWORD_FILE", `${TEST_ROLE_PASSWORDS[dbUser]}\n`);
  withFile(f, "QUEUE_DB_PASSWORD_FILE", `${TEST_ROLE_PASSWORDS.budmon_queue}\n`);
  return loadConfig("worker", f.env, readFileFrom(f.files));
}

export interface BuiltWorker {
  container: WorkerContainer;
  testDb: TestDatabase;
  obs: Observed;
  close(): Promise<void>;
}

/**
 * A WorkerContainer (F-96) for `roles` on a fresh copy of the template database (which has the
 * `test.*` queues), with an observed logger, reporter and metrics, and `overrides` on top.
 */
export async function buildWorkerContainer(
  roles: RolesSpec,
  overrides: Partial<WorkerContainer> = {},
): Promise<BuiltWorker> {
  const testDb = await createTestDatabase(roles === "capture" ? "budmon_capture" : "budmon_app");
  const obs = observed();
  const config = testWorkerConfig(testDb.endpoint, testDb.name, roles);
  const container = createWorkerContainer(config, {
    ...obs.overrides,
    ...overrides,
  });
  return {
    container,
    testDb,
    obs,
    close: async () => {
      await container.close();
      await testDb.drop();
    },
  };
}

/**
 * The same development worker configuration as an environment, with its secret files written
 * into `dir` (for entry points that take `env`, such as F-93's runCli).
 */
export function testWorkerEnv(
  dir: string,
  endpoint: Endpoint,
  database: string,
  roles: RolesSpec,
): Record<string, string> {
  const f = devWorker();
  const dbUser = roles === "capture" ? "budmon_capture" : "budmon_app";
  withFile(f, "DB_PASSWORD_FILE", `${TEST_ROLE_PASSWORDS[dbUser]}\n`);
  withFile(f, "QUEUE_DB_PASSWORD_FILE", `${TEST_ROLE_PASSWORDS.budmon_queue}\n`);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(f.env)) {
    if (value === undefined) continue;
    const content = f.files.get(value);
    if (content === undefined) {
      env[key] = value;
    } else {
      const file = path.join(dir, key.toLowerCase());
      writeFileSync(file, content);
      env[key] = file;
    }
  }
  return {
    ...env,
    WORKER_ROLES: roles,
    APP_ENV: "test",
    DB_HOST: endpoint.host,
    DB_PORT: String(endpoint.port),
    DB_NAME: database,
    DB_USER: dbUser,
    QUEUE_DB_USER: "budmon_queue",
    OBJECT_STORE_FS_ROOT: path.join(dir, "objects"),
  };
}
