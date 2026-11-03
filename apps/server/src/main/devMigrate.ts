// A-83: `pnpm db:migrate` in development. A wrapper around F-92's runMigrate that loads `.env`
// and defaults the migrator's login. Never part of the bundle; production runs
// `node dist/main/migrate.js` with its own environment.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { runCommand } from "../platform/observability/describeFailure.js";
import { repoRoot } from "./dbReset.js";
import { runMigrate } from "./migrate.js";

/** Sets the migrator's login unless the environment already does. */
export function devMigrateEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return {
    ...env,
    DB_USER: env["DB_USER"] ?? "budmon_migrator",
    DB_PASSWORD_FILE: env["DB_PASSWORD_FILE"] ?? ".data/dev-secrets/migrator_password",
  };
}

/** A-94: the shell's values (with the migrator login defaulted) over `.env`'s. Changes neither
 * argument. */
export function buildDevMigrateEnv(
  shellEnv: Readonly<Record<string, string | undefined>>,
  dotEnv: Readonly<Record<string, string>>,
): Record<string, string | undefined> {
  return { ...dotEnv, ...devMigrateEnv(shellEnv) };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await runCommand(
    "db:migrate",
    async () => {
      const root = repoRoot();
      process.chdir(root);
      const dotenv = path.join(root, ".env");
      // The shell wins over .env, and process.env isn't changed. The migrator's login defaults
      // apply unless the shell sets them: .env's DB_USER and DB_PASSWORD_FILE are the api's.
      const dotEnv = existsSync(dotenv)
        ? (parseEnv(readFileSync(dotenv, "utf8")) as Record<string, string>)
        : {};
      const env = buildDevMigrateEnv(process.env, dotEnv);
      return runMigrate(env);
    },
    (line) => process.stderr.write(`${line}\n`),
  );
}
