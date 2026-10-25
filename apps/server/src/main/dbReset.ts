// F-94: `pnpm db:reset` and `pnpm db:seed`.
import { readFileSync, realpathSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { runCommand } from "../platform/observability/describeFailure.js";
import { loadConfig } from "../platform/config/loadConfig.js";
import { serverRoot } from "../platform/config/serverRoot.js";
import type { DbLoginRole } from "../platform/config/schema.js";
import { createWorkerContainer } from "../platform/container.js";
import {
  ResetRefusedError,
  isAppEnv,
  resetDevelopmentDatabase,
  seedDevelopmentDatabase,
} from "../platform/db/reset.js";
import { runSchemaStep } from "../platform/db/schemaStep.js";
import { runSeeders, seeders } from "../platform/db/seed.js";

type Env = Readonly<Record<string, string | undefined>>;

const ROLES: readonly DbLoginRole[] = [
  "budmon_app",
  "budmon_capture",
  "budmon_queue",
  "budmon_monitor",
  "budmon_migrator",
];

export function repoRoot(): string {
  return path.join(serverRoot(), "../..");
}

/** Builds a worker container from the development configuration, runs every seeder, closes it. */
export async function seedAll(env: Env): Promise<void> {
  if (seeders.length === 0) return;
  const root = repoRoot();
  const config = loadConfig("worker", { ...env, WORKER_ROLES: "capture,general" }, (file) =>
    readFileSync(path.resolve(root, file)),
  );
  const container = createWorkerContainer(config);
  try {
    await runSeeders(container);
  } finally {
    await container.close();
  }
}

export async function runDbResetCli(
  argv: readonly string[],
  deps: {
    env: Env;
    readFile: (path: string) => string;
    resetDevelopmentDatabase: typeof resetDevelopmentDatabase;
    seedDevelopmentDatabase: typeof seedDevelopmentDatabase;
    seedAll: () => Promise<void>;
    stderr: (line: string) => void;
  },
): Promise<number> {
  // A bare `--` is a separator some pnpm versions forward literally (A-95).
  argv = argv.filter((arg) => arg !== "--");
  for (const arg of argv) {
    if (arg !== "--seed-only" && arg !== "--no-seed") {
      deps.stderr(`Unknown argument: ${arg}`);
      return 64;
    }
  }
  const seedOnly = argv.includes("--seed-only");
  const noSeed = argv.includes("--no-seed");
  if (seedOnly && noSeed) {
    deps.stderr("--seed-only and --no-seed can't be combined");
    return 64;
  }
  const superuserUrl = deps.env["DEV_SUPERUSER_URL"];
  if (superuserUrl === undefined || superuserUrl === "") {
    deps.stderr("DEV_SUPERUSER_URL is not set");
    return 64;
  }
  const rawAppEnv = deps.env["APP_ENV"] ?? "development";
  if (!isAppEnv(rawAppEnv)) {
    // Refused without ever writing the value (A-93).
    deps.stderr(new ResetRefusedError(seedOnly ? "db:seed" : "db:reset", "app_env").message);
    return 2;
  }
  const appEnv = rawAppEnv;

  const command = seedOnly ? "db:seed" : "db:reset";
  return runCommand(
    command,
    async () => {
      try {
        if (seedOnly) {
          await deps.seedDevelopmentDatabase({ appEnv, superuserUrl }, { seed: deps.seedAll });
          return 0;
        }
        const rolesFile = path.resolve(
          repoRoot(),
          deps.env["ROLE_SECRETS_FILE"] ?? ".data/dev-secrets/roles.json",
        );
        const secrets = JSON.parse(deps.readFile(rolesFile)) as Record<
          DbLoginRole,
          { password: string }
        >;
        const roleSecrets = Object.fromEntries(
          ROLES.map((role) => [role, { password: secrets[role].password }]),
        ) as Record<DbLoginRole, { password: string }>;
        await deps.resetDevelopmentDatabase(
          {
            appEnv,
            superuserUrl,
            databaseName: deps.env["DB_NAME"] ?? "budmon",
            migratorPassword: roleSecrets.budmon_migrator.password,
            roleSecrets,
            seed: !noSeed,
          },
          { runSchemaStep, seed: deps.seedAll },
        );
        return 0;
      } catch (error) {
        // A refusal is an expected outcome: its own message (which names only the reason) and
        // exit 2 (A-91). Anything else is unexpected: one runCommand line and exit 1.
        if (error instanceof ResetRefusedError) {
          deps.stderr(error.message);
          return 2;
        }
        throw error;
      }
    },
    deps.stderr,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  // `pnpm db:reset` runs with apps/server as the working directory; the developer's .env is in
  // the repository root.
  // Relative paths in .env are relative to the repository root (A-73).
  process.chdir(repoRoot());
  const dotenv = path.join(repoRoot(), ".env");
  // The shell wins over .env, and process.env is never changed: a .env line must not be able to
  // switch off a guard that reads process.env (A-64).
  const env: Record<string, string | undefined> = {
    ...(existsSync(dotenv) ? parseEnv(readFileSync(dotenv, "utf8")) : {}),
    ...process.env,
  };
  process.exitCode = await runDbResetCli(process.argv.slice(2), {
    env,
    readFile: (file) => readFileSync(file, "utf8"),
    resetDevelopmentDatabase,
    seedDevelopmentDatabase,
    seedAll: () => seedAll(env),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
}
