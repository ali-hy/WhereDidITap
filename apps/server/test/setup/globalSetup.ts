// Integration-test global setup (§10.1), owned by the test-architect.
//
// 1. Start postgres 18 with Testcontainers (pg_stat_statements loaded, track_utility off), or use
//    TEST_DATABASE_URL (a superuser URL) when it's set.
// 2. bootstrapCluster (F-14), then runSchemaStep (F-19) into `budmon_template`, mode `push`, or
//    `migrate` when BUDMON_SCHEMA_MODE=migrate, with the test role passwords.
// 3. Mark the template IS_TEMPLATE and create `budmon_test_dbcreator` (LOGIN CREATEDB, not a
//    superuser), so test files can copy the template (createTestDatabase) without the superuser:
//    the superuser is used only here (S-2 acceptance criterion 3).
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { bootstrapCluster } from "../../src/platform/db/clusterBootstrap.js";
import { runSchemaStep } from "../../src/platform/db/schemaStep.js";
import { templateJobRegistry } from "../support/jobs.js";
import { connectDatabase, schemaStepInput } from "../support/platform.js";
import { POSTGRES_IMAGE } from "./postgresImage.js";
import {
  POSTGRES_COMMAND,
  TEST_ROLE_PASSWORDS,
  connectionString,
  type Endpoint,
} from "../support/postgres.js";

export const TEMPLATE_DATABASE = "budmon_template";
export const DB_CREATOR_ROLE = "budmon_test_dbcreator";

export interface IntegrationDatabase {
  host: string;
  port: number;
  template: string;
  dbCreator: { user: string; password: string };
}

declare module "vitest" {
  export interface ProvidedContext {
    integrationDatabase: IntegrationDatabase;
  }
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function superuserFromUrl(url: string): { endpoint: Endpoint; url: (db: string) => string } {
  const parsed = new URL(url);
  const endpoint = { host: parsed.hostname, port: Number.parseInt(parsed.port || "5432", 10) };
  return {
    endpoint,
    url: (db: string) => {
      const copy = new URL(url);
      copy.pathname = `/${db}`;
      return copy.toString();
    },
  };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let container: StartedPostgreSqlContainer | undefined;
  let superuser: { endpoint: Endpoint; url: (db: string) => string };

  const external = process.env["TEST_DATABASE_URL"];
  if (external !== undefined && external !== "") {
    superuser = superuserFromUrl(external);
  } else {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).withCommand(POSTGRES_COMMAND).start();
    const started = container;
    const endpoint = { host: started.getHost(), port: started.getPort() };
    superuser = {
      endpoint,
      url: (db: string) =>
        connectionString(endpoint, started.getUsername(), started.getPassword(), db),
    };
  }

  // A reused cluster (TEST_DATABASE_URL) may hold a template and copies from an earlier run.
  await withClient(superuser.url("postgres"), async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname = $1 OR datname LIKE 't\\_%'",
      [TEMPLATE_DATABASE],
    );
    for (const { datname } of rows) {
      await client.query(`ALTER DATABASE ${client.escapeIdentifier(datname)} IS_TEMPLATE false`);
      await client.query(`DROP DATABASE ${client.escapeIdentifier(datname)} WITH (FORCE)`);
    }
  });

  await withClient(superuser.url("postgres"), async (client) => {
    await bootstrapCluster(client, {
      databaseName: TEMPLATE_DATABASE,
      migrator: { password: TEST_ROLE_PASSWORDS.budmon_migrator },
    });
  });

  const migrator = connectDatabase(
    superuser.endpoint,
    "budmon_migrator",
    TEST_ROLE_PASSWORDS.budmon_migrator,
    TEMPLATE_DATABASE,
  );
  try {
    const mode = process.env["BUDMON_SCHEMA_MODE"] === "migrate" ? "migrate" : "push";
    // A-202: every production queue plus the test.* ones.
    const registry = templateJobRegistry();
    await runSchemaStep(schemaStepInput(migrator, mode, undefined, undefined, registry));
  } finally {
    await migrator.close();
  }

  const dbCreatorPassword = randomBytes(18).toString("base64url");
  await withClient(superuser.url("postgres"), async (client) => {
    const role = client.escapeIdentifier(DB_CREATOR_ROLE);
    const password = client.escapeLiteral(dbCreatorPassword);
    const { rowCount } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [
      DB_CREATOR_ROLE,
    ]);
    await client.query(
      rowCount === 0
        ? `CREATE ROLE ${role} LOGIN CREATEDB NOSUPERUSER PASSWORD ${password}`
        : `ALTER ROLE ${role} LOGIN CREATEDB NOSUPERUSER PASSWORD ${password}`,
    );
    // B-3 (S-4 review): DROP DATABASE … WITH (FORCE) terminates the remaining sessions, which
    // needs the right to signal the login roles' backends (never a superuser's).
    await client.query(`GRANT pg_signal_backend TO ${role}`);
    await client.query(
      `ALTER DATABASE ${client.escapeIdentifier(TEMPLATE_DATABASE)} IS_TEMPLATE true`,
    );
  });

  project.provide("integrationDatabase", {
    host: superuser.endpoint.host,
    port: superuser.endpoint.port,
    template: TEMPLATE_DATABASE,
    dbCreator: { user: DB_CREATOR_ROLE, password: dbCreatorPassword },
  });

  return async () => {
    if (container !== undefined) {
      await container.stop();
      return;
    }
    await withClient(superuser.url("postgres"), async (client) => {
      const { rows } = await client.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE 't\\_%'",
      );
      for (const { datname } of rows) {
        await client.query(`DROP DATABASE ${client.escapeIdentifier(datname)} WITH (FORCE)`);
      }
    });
  };
}
