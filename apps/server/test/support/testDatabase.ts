// Per-file test databases (§10.1 steps 3 and 4), owned by the test-architect.
//
// createTestDatabase(role) copies `budmon_template` into `t_<random>` as `budmon_test_dbcreator`
// (CREATEDB, not a superuser), re-applies the database-level privileges F-14/F-15 set (which a
// copy doesn't carry: REVOKE ALL FROM PUBLIC, CONNECT for the login roles), and connects as
// `role` (budmon_app by default). resetBetweenTests truncates every public table except
// `currencies`, as budmon_migrator, and empties pgboss.job as budmon_queue once that schema
// exists (S-6).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import type { Database } from "../../src/platform/db/types.js";
import { connectDatabase } from "./platform.js";
import {
  LOGIN_ROLES,
  TEST_ROLE_PASSWORDS,
  connectionString,
  type Endpoint,
  type LoginRole,
} from "./postgres.js";

export interface TestDatabase {
  name: string;
  role: LoginRole;
  endpoint: Endpoint;
  /** Connected as `role`. */
  database: Database;
  /** Opens another connection to this database as `role` (callers close it). */
  connectAs: (role: LoginRole) => Database;
  /** A connection string for this database as `role`. */
  urlAs: (role: LoginRole) => string;
  drop: () => Promise<void>;
}

async function asDbCreator<T>(database: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const info = inject("integrationDatabase");
  const client = new pg.Client({
    connectionString: connectionString(
      info,
      info.dbCreator.user,
      info.dbCreator.password,
      database,
    ),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Polls pg_stat_activity until no backend is connected to `database`, or the timeout passes. */
async function waitForNoSessions(
  client: pg.Client,
  database: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [database],
    );
    if (rows[0]?.n === "0" || Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function createTestDatabase(role: LoginRole = "budmon_app"): Promise<TestDatabase> {
  const info = inject("integrationDatabase");
  const name = `t_${randomBytes(6).toString("hex")}`;
  await asDbCreator("postgres", async (client) => {
    await client.query(
      `CREATE DATABASE ${client.escapeIdentifier(name)} TEMPLATE ${client.escapeIdentifier(info.template)}`,
    );
  });
  await asDbCreator(name, async (client) => {
    const db = client.escapeIdentifier(name);
    await client.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await client.query(
      `GRANT CONNECT ON DATABASE ${db} TO ${LOGIN_ROLES.map((r) => client.escapeIdentifier(r)).join(", ")}`,
    );
    // In a deployed database budmon_migrator is the owner (F-14) and can create schemas, as
    // Drizzle's migrator does for schema drizzle; a copy belongs to the test database creator, so
    // the migrator gets that one privilege here.
    await client.query(`GRANT CREATE ON DATABASE ${db} TO budmon_migrator`);
  });

  const endpoint = { host: info.host, port: info.port };
  const connectAs = (as: LoginRole): Database =>
    connectDatabase(endpoint, as, TEST_ROLE_PASSWORDS[as], name);
  const database = connectAs(role);
  return {
    name,
    role,
    endpoint,
    database,
    connectAs,
    urlAs: (as) => connectionString(endpoint, as, TEST_ROLE_PASSWORDS[as], name),
    drop: async () => {
      await database.close();
      await asDbCreator("postgres", async (client) => {
        // B-3 (S-4 review): pool.end() resolves before the server-side backends have exited, so
        // wait (up to 10 s) for the database's sessions to go before dropping; FORCE then ends any
        // straggler (the creator holds pg_signal_backend).
        await waitForNoSessions(client, name, 10_000);
        await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)} WITH (FORCE)`);
      });
    },
  };
}

/** Truncates every `public` table except `currencies`; empties `pgboss.job` when it exists. */
export async function resetBetweenTests(testDb: TestDatabase): Promise<void> {
  const migrator = new pg.Client({ connectionString: testDb.urlAs("budmon_migrator") });
  await migrator.connect();
  try {
    const { rows } = await migrator.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'currencies'",
    );
    if (rows.length > 0) {
      await migrator.query(
        `TRUNCATE ${rows.map((r) => `public.${migrator.escapeIdentifier(r.tablename)}`).join(", ")}`,
      );
    }
    const { rowCount } = await migrator.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job'",
    );
    if (rowCount !== 0) {
      await migrator.query("BEGIN");
      await migrator.query("SET LOCAL ROLE budmon_queue");
      await migrator.query("DELETE FROM pgboss.job");
      await migrator.query("COMMIT");
    }
  } finally {
    await migrator.end();
  }
}
