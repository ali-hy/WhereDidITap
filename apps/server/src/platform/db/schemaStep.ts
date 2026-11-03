// F-19: the schema step as the migrator: roles, schema, queue schema, grants, reference data and
// queues (S-6 adds steps 3 and 6, A-49).
import { PgBoss } from "pg-boss";
import type { AppEnv, DbLoginRole } from "../config/schema.js";
import type { Logger } from "../observability/logger.js";
import { installOrUpgradeQueueSchema } from "../queue/queueSchema.js";
import { applyQueuePolicies } from "../queue/queuePolicies.js";
import { syncQueues } from "../queue/queueSync.js";
import type { JobRegistry } from "../queue/registry.js";
import { applyTableGrants, grantMigrationsTableRead, tableGrants } from "./grants.js";
import { applyCommittedMigrations, readJournal } from "./migrations.js";
import { loadReferenceData, type ReferenceData } from "./referenceData.js";
import { applyRolesAndPrivileges } from "./roles.js";
import type { Database } from "./types.js";

export { SchemaStepError, type SchemaStepCode } from "./schemaStepError.js";

export interface SchemaStepReport {
  migrationsApplied: number;
  pushedStatements: number;
  queueSchema: "installed" | "upgraded" | "current";
  currenciesUpserted: number;
  queuesCreated: number;
  queuesUpdated: number;
}

/** F-75's pg-boss: the migrator's own connection settings, acting as budmon_queue. */
async function syncAsQueueRole(
  database: Database,
  registry: JobRegistry,
  logger: Logger,
): Promise<{ created: number; updated: number }> {
  const o = database.pool.options;
  const boss = new PgBoss({
    ...(o.host === undefined ? {} : { host: o.host }),
    ...(o.port === undefined ? {} : { port: o.port }),
    ...(o.database === undefined ? {} : { database: o.database }),
    ...(o.user === undefined ? {} : { user: o.user }),
    ...(typeof o.password === "string" ? { password: o.password } : {}),
    ssl: o.ssl ?? false,
    options: "-c role=budmon_queue",
    max: 1,
    application_name: "budmon-migrate-queues",
    schema: "pgboss",
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    useListenNotify: false,
  });
  boss.on("error", (error) => {
    logger.error("queue_error", {}, error);
  });
  await boss.start();
  try {
    return await syncQueues(boss, registry, logger);
  } finally {
    await boss.stop({ graceful: false });
  }
}

/** A-204: a fresh database: none of the granted tables exists yet. */
async function noGrantedTables(database: Database): Promise<boolean> {
  const { rows } = await database.handle.executeSql(
    "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)",
    [Object.keys(tableGrants)],
  );
  return rows[0]?.["n"] === 0;
}

export async function runSchemaStep(input: {
  mode: "migrate" | "push";
  database: Database;
  migrationsFolder: string;
  roleSecrets: Record<DbLoginRole, { verifier: string } | { password: string }>;
  appEnv: AppEnv;
  jobRegistry: JobRegistry;
  referenceData: ReferenceData;
  logger: Logger;
}): Promise<SchemaStepReport> {
  const { database, logger } = input;
  const timed = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    const result = await fn();
    logger.info("schema_step", { step, durationMs: Date.now() - started });
    return result;
  };

  await timed("roles", () =>
    applyRolesAndPrivileges(database.handle, input.roleSecrets, input.appEnv, logger),
  );

  let migrationsApplied = 0;
  let pushedStatements = 0;
  let fresh = false;
  if (input.mode === "push") {
    // Loaded on demand: drizzle-kit is a development dependency, so the production bundle
    // never contains or imports it.
    const specifier = "./schemaPush.js";
    const { pushSchemaOntoEmpty } = (await import(
      /* @vite-ignore */ specifier
    )) as typeof import("./schemaPush.js");
    pushedStatements = (await timed("push", () => pushSchemaOntoEmpty(database.handle))).statements;
  } else {
    const migrations = await timed("migrations", () =>
      applyCommittedMigrations(database, input.migrationsFolder),
    );
    migrationsApplied = migrations.applied;
    // 2b (A-179, A-204): a fresh database (empty journal, nothing recorded, no tables; every
    // build before the first release) has nothing to grant or load yet.
    fresh =
      readJournal(input.migrationsFolder).length === 0 &&
      migrations.verified === 0 &&
      (await noGrantedTables(database));
  }

  // 3.
  const queueSchema = await timed("queue_schema", () =>
    installOrUpgradeQueueSchema(database.handle),
  );

  let currenciesUpserted = 0;
  if (fresh) {
    // Only F-16's step 5 (A-130).
    await timed("grants", () => grantMigrationsTableRead(database.handle));
  } else {
    // 4, 5.
    await timed("grants", () => applyTableGrants(database.handle));
    currenciesUpserted = (
      await timed("reference_data", () => loadReferenceData(database.handle, input.referenceData))
    ).upserted;
  }

  // 6.
  const queues = await timed("queues", () => syncAsQueueRole(database, input.jobRegistry, logger));
  // 6b (A-227).
  await timed("queue_policies", () => applyQueuePolicies(database.handle, input.jobRegistry));
  return {
    migrationsApplied,
    pushedStatements,
    queueSchema,
    currenciesUpserted,
    queuesCreated: queues.created,
    queuesUpdated: queues.updated,
  };
}
