// F-92: the migrate process (`pnpm db:migrate`, image entry `node dist/main/migrate.js`).
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";
import type { Config, DbLoginRole } from "../platform/config/schema.js";
import { buildJobRegistry } from "../platform/queue/appRegistry.js";
import { installProxySupport } from "../platform/crypto/proxy.js";
import { serverRoot } from "../platform/config/serverRoot.js";
import { createDatabase } from "../platform/db/client.js";
import { alterRolePassword } from "../platform/db/clusterBootstrap.js";
import { withoutTracing } from "../platform/db/suppressTracing.js";
import {
  JournalInvalidError,
  MigrationFailedError,
  readJournal,
  UnknownMigrationError,
} from "../platform/db/migrations.js";
import { runSchemaStep, SchemaStepError } from "../platform/db/schemaStep.js";
import iso4217 from "../platform/fx/iso4217.json" with { type: "json" };
import { describeFailure } from "../platform/observability/describeFailure.js";
import { createLogger, type Logger } from "../platform/observability/logger.js";
import type { Secret } from "../platform/observability/redaction.js";
import type { Database } from "../platform/db/types.js";

const stderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

async function connect(
  config: Config,
  password: Secret<string>,
  logger: Logger,
): Promise<{ database: Database; ok: true } | { database: Database; ok: false; code: unknown }> {
  const database = createDatabase(
    { ...config.db, password },
    {
      applicationName: "budmon-migrate",
      onError: () => {
        logger.error("database_pool_error");
      },
    },
  );
  try {
    await database.handle.executeSql("SELECT 1");
    return { database, ok: true };
  } catch (error) {
    return { database, ok: false, code: (error as { code?: unknown }).code };
  }
}

/** F-92 as a function: returns the exit code. */
export async function runMigrate(
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  // F-122: first.
  installProxySupport(env);
  const config = loadConfigOrReport("migrate", env, readFileSync, stderr);
  if (config?.migrate === undefined) return EXIT_CONFIG;
  const logger = createLogger({
    service: "migrate",
    release: config.release,
    level: config.logLevel,
    appEnv: config.appEnv,
    // stdout carries only the report.
    destination: { write: (line: string) => process.stderr.write(line) },
  });
  if (config.db.user !== "budmon_migrator") {
    // A-359: a token-safe reason (the old sentence failed F-30 and was logged as [invalid]).
    logger.error("startup_failed", { reason: "db_user_not_migrator" });
    return 1;
  }
  const migrationsFolder = path.join(serverRoot(), "drizzle");
  // A-160: the journal is checked before the database is touched (read again by F-18).
  try {
    readJournal(migrationsFolder);
  } catch (error) {
    logger.error("startup_failed", describeFailure(error));
    return error instanceof JournalInvalidError ? 5 : 1;
  }

  const roleSecrets = Object.fromEntries(
    Object.entries(config.migrate.roleSecrets).map(([role, secret]) => [
      role,
      "verifier" in secret ? secret : { password: secret.password.reveal() },
    ]),
  ) as Record<DbLoginRole, { verifier: string } | { password: string }>;

  let attempt = await connect(config, config.db.password, logger);
  const previous = config.migrate.previousPassword;
  if (!attempt.ok && attempt.code === "28P01" && previous !== undefined) {
    // A rotated migrator password (A-384): log in with the previous one, re-key the migrator to
    // its ROLE_SECRETS entry on that connection, then reconnect with DB_PASSWORD, so every later
    // connection (the pool's and the queue sync's) uses the new password.
    await attempt.database.close();
    logger.warn("migrator_previous_password_used");
    const fallback = await connect(config, previous, logger);
    if (!fallback.ok) {
      // Neither password works: the schema step below reports the login failure, as before.
      attempt = fallback;
    } else {
      try {
        await withoutTracing(() =>
          fallback.database.handle.executeSql(
            alterRolePassword("budmon_migrator", roleSecrets.budmon_migrator),
          ),
        );
      } finally {
        await fallback.database.close();
      }
      attempt = await connect(config, config.db.password, logger);
      if (!attempt.ok) {
        await attempt.database.close();
        logger.error("startup_failed", { reason: "migrator_password_mismatch" });
        return 1;
      }
    }
  }
  const { database } = attempt;
  try {
    const report = await runSchemaStep({
      mode: "migrate",
      database,
      migrationsFolder,
      roleSecrets,
      appEnv: config.appEnv,
      jobRegistry: buildJobRegistry(),
      referenceData: { currencies: iso4217 },
      logger,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    logger.error("startup_failed", describeFailure(error));
    if (error instanceof SchemaStepError) return 3;
    if (error instanceof UnknownMigrationError) return 4;
    if (error instanceof MigrationFailedError || error instanceof JournalInvalidError) return 5;
    return 1;
  } finally {
    await database.close();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await runMigrate(process.env);
}
