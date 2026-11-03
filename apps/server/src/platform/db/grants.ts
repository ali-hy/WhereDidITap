// F-16: table grants for the application roles (schema step 4).
import { escapeIdentifier } from "./escape.js";
import { SchemaStepError } from "./schemaStepError.js";
import type { DbHandle } from "./types.js";

export type Privilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
export interface TableGrant {
  app: readonly Privilege[];
  capture: readonly Privilege[];
  credential: boolean;
}

/** Keyed by SQL table name. Modules add their tables in their own slices. */
export const tableGrants: Readonly<Record<string, TableGrant>> = {
  currencies: { app: ["SELECT"], capture: ["SELECT"], credential: false },
  exchange_rates: { app: ["SELECT", "INSERT"], capture: ["SELECT"], credential: false },
  idempotency_records: {
    app: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    capture: [],
    credential: false,
  },
  rate_limit_counters: {
    app: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    capture: [],
    credential: false,
  },
};

export async function applyTableGrants(
  migrator: DbHandle,
  grants: Readonly<Record<string, TableGrant>> = tableGrants,
): Promise<void> {
  const { rows } = await migrator.executeSql(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const tables = rows.map((row) => String(row["tablename"]));

  // Validate everything before the first statement.
  for (const table of Object.keys(grants)) {
    // A-179: a listed table that doesn't exist is a schema defect, not a raw 42P01.
    if (!tables.includes(table)) throw new SchemaStepError("table_missing", table);
  }
  for (const table of tables) {
    const grant = grants[table];
    if (grant === undefined) throw new SchemaStepError("table_without_grants", table);
    if (grant.credential && grant.capture.length > 0) {
      throw new SchemaStepError("credential_table_granted_to_capture", table);
    }
  }

  for (const table of tables) {
    const grant = grants[table];
    if (grant === undefined) continue;
    const name = `public.${escapeIdentifier(table)}`;
    await migrator.executeSql(`REVOKE ALL ON TABLE ${name} FROM budmon_app, budmon_capture`);
    if (grant.app.length > 0) {
      await migrator.executeSql(`GRANT ${grant.app.join(", ")} ON TABLE ${name} TO budmon_app`);
    }
    if (grant.capture.length > 0) {
      await migrator.executeSql(
        `GRANT ${grant.capture.join(", ")} ON TABLE ${name} TO budmon_capture`,
      );
    }
    // Sequences of a table that can be inserted into.
    const sequences = await migrator.executeSql(
      `SELECT format('%I.%I', n.nspname, s.relname) AS sequence
       FROM pg_class s
       JOIN pg_namespace n ON n.oid = s.relnamespace
       JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
       WHERE s.relkind = 'S' AND d.refobjid = $1::regclass`,
      [name],
    );
    for (const row of sequences.rows) {
      const sequence = String(row["sequence"]);
      await migrator.executeSql(
        `REVOKE ALL ON SEQUENCE ${sequence} FROM budmon_app, budmon_capture`,
      );
      if (grant.app.includes("INSERT")) {
        await migrator.executeSql(`GRANT USAGE, SELECT ON SEQUENCE ${sequence} TO budmon_app`);
      }
      if (grant.capture.includes("INSERT")) {
        await migrator.executeSql(`GRANT USAGE, SELECT ON SEQUENCE ${sequence} TO budmon_capture`);
      }
    }
  }

  await grantMigrationsTableRead(migrator);
}

/** F-16 step 5 (A-130): the API's readiness check reads the migrations table. Push-mode databases
 * have no drizzle schema and skip this. */
export async function grantMigrationsTableRead(migrator: DbHandle): Promise<void> {
  const drizzle = await migrator.executeSql(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
  );
  if (drizzle.rows[0]?.["present"] === true) {
    await migrator.executeSql("GRANT USAGE ON SCHEMA drizzle TO budmon_app");
    await migrator.executeSql("GRANT SELECT ON drizzle.__drizzle_migrations TO budmon_app");
  }
}
