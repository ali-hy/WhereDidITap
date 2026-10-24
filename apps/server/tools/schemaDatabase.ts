// Shared by F-182 and F-6b: a fresh database built on a throwaway cluster the way a deployment
// builds one, F-14 (bootstrapCluster) then F-19 (runSchemaStep) in push or migrate mode.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createDatabase } from "../src/platform/db/client.js";
import { bootstrapCluster } from "../src/platform/db/clusterBootstrap.js";
import { runSchemaStep } from "../src/platform/db/schemaStep.js";
import type { DbLoginRole } from "../src/platform/config/schema.js";
import iso4217 from "../src/platform/fx/iso4217.json" with { type: "json" };
import { createLogger } from "../src/platform/observability/logger.js";
import { Secret } from "../src/platform/observability/redaction.js";
import { buildJobRegistry } from "../src/platform/queue/appRegistry.js";

const ROLES: readonly DbLoginRole[] = [
  "budmon_app",
  "budmon_capture",
  "budmon_queue",
  "budmon_monitor",
  "budmon_migrator",
];

/** Throwaway passwords for the cluster's login roles, one set per process. */
const PASSWORDS = Object.fromEntries(
  ROLES.map((role) => [role, randomBytes(24).toString("base64url")]),
) as Record<DbLoginRole, string>;

async function withSuperuser<T>(
  superuserUrl: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Drops `name` if it exists, then builds it from scratch: F-14, then F-19 in `mode` with the
 * migrations in `migrationsFolder`. Throws what F-19 throws (MigrationFailedError and others).
 */
export async function buildSchemaDatabase(input: {
  superuserUrl: string;
  name: string;
  mode: "push" | "migrate";
  migrationsFolder: string;
}): Promise<void> {
  await withSuperuser(input.superuserUrl, async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(input.name)} WITH (FORCE)`);
    await bootstrapCluster(admin, {
      databaseName: input.name,
      migrator: { password: PASSWORDS.budmon_migrator },
    });
  });
  const url = new URL(input.superuserUrl);
  const database = createDatabase(
    {
      host: url.hostname,
      port: Number(url.port === "" ? "5432" : url.port),
      name: input.name,
      user: "budmon_migrator",
      password: Secret.of(PASSWORDS.budmon_migrator),
      sslmode: "disable",
      poolMax: 2,
    },
    { applicationName: "budmon-release-tools" },
  );
  try {
    await runSchemaStep({
      mode: input.mode,
      database,
      migrationsFolder: input.migrationsFolder,
      roleSecrets: Object.fromEntries(
        ROLES.map((role) => [role, { password: PASSWORDS[role] }]),
      ) as Record<DbLoginRole, { password: string }>,
      appEnv: "test",
      jobRegistry: buildJobRegistry(),
      referenceData: { currencies: iso4217 },
      logger: createLogger({
        service: "release-tools",
        release: "tools",
        level: "error",
        destination: { write: (line: string) => process.stderr.write(line) },
      }),
    });
  } finally {
    await database.close();
  }
}

/** A started Postgres: its superuser URL, pg_dump inside its container (A-378), and stop. */
export interface StartedPostgres {
  superuserUrl: string;
  pgDump(database: string, args: readonly string[]): Promise<string>;
  stop(): Promise<void>;
}

/** A Postgres container from the pinned test image, for the CLIs (F-182, F-6b). */
export async function startPostgresContainer(): Promise<StartedPostgres> {
  const [{ PostgreSqlContainer }, { POSTGRES_IMAGE }] = await Promise.all([
    import("@testcontainers/postgresql"),
    import("../test/setup/postgresImage.js"),
  ]);
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  return {
    superuserUrl: container.getConnectionUri(),
    // A-378: the container's own pg_dump, the same major version as the server.
    pgDump: async (database, args) => {
      const result = await container.exec([
        "pg_dump",
        "-U",
        container.getUsername(),
        ...args,
        database,
      ]);
      if (result.exitCode !== 0) {
        throw new Error(`pg_dump failed (exit ${String(result.exitCode)}): ${result.stderr}`);
      }
      return result.stdout;
    },
    stop: async () => {
      await container.stop();
    },
  };
}
