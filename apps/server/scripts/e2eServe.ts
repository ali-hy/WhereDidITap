// F-222 (A-329): the stack Playwright runs against. Postgres in a container, the API on
// 127.0.0.1:8787 and a general worker in-process (APP_ENV=test), and the web app built with
// fixtures and pseudo-locales, served by `vite preview` on 127.0.0.1:4173 with /api and
// /dev/objects proxied to the API. SIGTERM or SIGINT stops everything and exits 0.
import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { loadConfigOrReport } from "../src/platform/config/startup.js";
import type { Config, DbLoginRole, ProcessKind } from "../src/platform/config/schema.js";
import { serverRoot } from "../src/platform/config/serverRoot.js";
import { createApiContainer, createWorkerContainer } from "../src/platform/container.js";
import { resetDevelopmentDatabase } from "../src/platform/db/reset.js";
import { LOGIN_ROLES } from "../src/platform/db/roles.js";
import { runSchemaStep } from "../src/platform/db/schemaStep.js";
import { runSeeders } from "../src/platform/db/seed.js";
import { createApiServer } from "../src/platform/http/server.js";
import { failureLine } from "../src/platform/observability/describeFailure.js";
import { buildHandlerMap } from "../src/platform/queue/handlers.js";
import { runGeneralStartHooks, startWorkers } from "../src/platform/queue/workers.js";
import { POSTGRES_IMAGE } from "../test/setup/postgresImage.js";
import { POSTGRES_COMMAND } from "../test/support/postgres.js";

const API_HOST = "127.0.0.1";
/** A-395: a port from the environment, or the default; anything but 1 to 65535 is an error. */
function portFrom(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!/^[0-9]+$/.test(raw) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number`);
  }
  return port;
}

const DATABASE = "budmon";

const secret = (bytes: number) => randomBytes(bytes).toString("base64");
const keyRing = () => JSON.stringify({ current: "k1", keys: { k1: secret(32) } });

/** N-6: what pnpm and Vite need from the caller's environment; nothing else is passed on. */
const CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "CI",
  "COREPACK_HOME",
  "PNPM_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
];

/** Runs `pnpm --filter @budmon/web exec vite <args>` with only the listed environment. */
function vite(args: readonly string[], env: Record<string, string>): ChildProcess {
  const base: Record<string, string> = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) base[key] = value;
  }
  return spawn("pnpm", ["--filter", "@budmon/web", "exec", "vite", ...args], {
    cwd: path.join(serverRoot(), "../.."),
    env: { ...base, ...env },
    stdio: "inherit",
  });
}

/** B-8: resolves once `url` answers; rejects if `child` exits first or `timeoutMs` passes. */
async function waitForUrl(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const state = { exited: false };
  child.once("exit", () => {
    state.exited = true;
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.exited) throw new Error("vite preview exited during start-up");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("vite preview didn't answer in time");
}

/** The configuration, or the problems on stderr and a thrown error. */
function config(kind: ProcessKind, env: Record<string, string>): Config {
  const loaded = loadConfigOrReport(kind, env, readFileSync, (line) => {
    process.stderr.write(`${line}\n`);
  });
  if (loaded === null) throw new Error(`invalid ${kind} configuration`);
  return loaded;
}

function exited(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

/** Everything started so far, stopped in reverse order (also by SIGTERM/SIGINT during start-up). */
const stops: (() => Promise<void>)[] = [];
let stopping: Promise<void> | undefined;
const stopAll = (): Promise<void> => {
  stopping ??= (async () => {
    for (const stop of stops.reverse()) await stop().catch(() => undefined);
  })();
  return stopping;
};

async function main(): Promise<void> {
  // A-395: inside the try below, so a bad port is reported like any start-up failure.
  const API_PORT = portFrom("E2E_API_PORT", 8787);
  const PREVIEW_PORT = portFrom("E2E_WEB_PORT", 4173);
  {
    // 1. Postgres, the schema (push) and the seeders. B-7: a random superuser and password.
    // (Testcontainers 12 has no option to publish the port on loopback only.)
    const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withCommand(POSTGRES_COMMAND)
      .withUsername("budmon_e2e_su")
      .withPassword(randomBytes(24).toString("base64url"))
      .start();
    stops.push(async () => {
      await container.stop();
    });
    const host = container.getHost();
    const port = String(container.getPort());
    const superuserUrl = `postgres://${encodeURIComponent(container.getUsername())}:${encodeURIComponent(container.getPassword())}@${host}:${port}/postgres`;
    const passwords = Object.fromEntries(
      LOGIN_ROLES.map((role) => [role, randomBytes(18).toString("base64url")]),
    ) as Record<DbLoginRole, string>;

    const dir = mkdtempSync(path.join(tmpdir(), "budmon-e2e-"));
    stops.push(() => {
      rmSync(dir, { recursive: true, force: true });
      return Promise.resolve();
    });
    const file = (name: string, content: string): string => {
      const p = path.join(dir, name);
      writeFileSync(p, content);
      return p;
    };
    const objects = path.join(dir, "objects");
    mkdirSync(objects);
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
    const common = {
      APP_ENV: "test",
      DB_HOST: host,
      DB_PORT: port,
      DB_NAME: DATABASE,
      // The test environment allows http only for localhost (A-76).
      PUBLIC_ORIGIN: `http://localhost:${String(PREVIEW_PORT)}`,
      OBJECT_STORE_KIND: "fs",
      OBJECT_STORE_FS_ROOT: objects,
      CAPTURE_KEY_VERSION: "local:1",
      CAPTURE_PUBLIC_KEY_FILE: file(
        "capture-public",
        publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    };
    const apiEnv = {
      ...common,
      DB_USER: "budmon_app",
      DB_PASSWORD_FILE: file("api-db", passwords.budmon_app),
      HOST: API_HOST,
      PORT: String(API_PORT),
      CURSOR_KEY_FILE: file("cursor", secret(32)),
      RATE_LIMIT_HMAC_KEY_FILE: file("rate-limit", secret(32)),
      API_SECRETS_KEYS_FILE: file("api-secrets", keyRing()),
      RECOVERY_CODE_HMAC_KEYS_FILE: file("recovery", keyRing()),
      DEV_OBJECTS_SIGNING_KEY_FILE: file("dev-objects", secret(32)),
    };
    const workerEnv = {
      ...common,
      WORKER_ROLES: "general",
      DB_USER: "budmon_app",
      DB_PASSWORD_FILE: file("worker-db", passwords.budmon_app),
      QUEUE_DB_USER: "budmon_queue",
      QUEUE_DB_PASSWORD_FILE: file("queue-db", passwords.budmon_queue),
      FX_PROVIDER: "fixed",
      KMS_PROVIDER: "local",
      SMTP_URL: "smtp://127.0.0.1:1025",
      EMAIL_FROM: "Budmon <no-reply@budmon.local>",
    };
    const workerConfig = config("worker", workerEnv);
    await resetDevelopmentDatabase(
      {
        appEnv: "test",
        superuserUrl,
        databaseName: DATABASE,
        migratorPassword: passwords.budmon_migrator,
        roleSecrets: Object.fromEntries(
          LOGIN_ROLES.map((role) => [role, { password: passwords[role] }]),
        ) as Record<DbLoginRole, { password: string }>,
        seed: true,
        allowNonLocalHost: true,
      },
      {
        runSchemaStep,
        seed: async () => {
          const seeding = createWorkerContainer(workerConfig);
          try {
            await runSeeders(seeding);
          } finally {
            await seeding.close();
          }
        },
      },
    );

    // 2. The API and a general worker, in-process.
    const api = createApiContainer(config("api", apiEnv));
    const app = await createApiServer(api);
    await app.listen({ host: API_HOST, port: API_PORT });
    stops.push(async () => {
      await app.close();
      await api.close();
    });
    const worker = createWorkerContainer(workerConfig);
    const workers = await startWorkers(worker, buildHandlerMap(worker), {
      heartbeatPath: path.join(dir, "heartbeat"),
    });
    await runGeneralStartHooks(worker);
    stops.push(async () => {
      await workers.stop();
      await worker.close();
    });

    // 3. The web app with fixtures and pseudo-locales, then vite preview (proxying the API).
    const outDir = path.join(dir, "web");
    // A-395: vite.config.ts's preview proxy targets E2E_API_PORT.
    // F-222: e2e has no Sentry DSN. Vite gives the process environment precedence over
    // apps/web/.env* (including .env.local, which every mode loads), so an empty value here
    // keeps a developer's VITE_SENTRY_DSN out of the bundle.
    const buildEnv = {
      VITE_SENTRY_DSN: "",
      VITE_FIXTURES: "1",
      VITE_PSEUDO_LOCALES: "1",
      E2E_API_PORT: String(API_PORT),
    };
    if ((await exited(vite(["build", "--outDir", outDir], buildEnv))) !== 0) {
      throw new Error("vite build failed");
    }
    const preview = vite(
      [
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(PREVIEW_PORT),
        "--strictPort",
        "--outDir",
        outDir,
      ],
      buildEnv,
    );
    const previewExit = exited(preview);
    stops.push(async () => {
      preview.kill("SIGTERM");
      await previewExit;
    });
    await waitForUrl(`http://127.0.0.1:${String(PREVIEW_PORT)}/`, preview, 120_000);
  }
}

// B-8: the handlers come first, so a signal during start-up stops what has started.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void stopAll().then(() => process.exit(0));
  });
}
try {
  await main();
} catch (error) {
  process.stderr.write(`${failureLine("e2e:serve", error)}\n`);
  await stopAll();
  process.exit(1);
}
