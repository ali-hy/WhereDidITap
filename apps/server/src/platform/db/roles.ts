// F-15: roles, passwords and database-level privileges (schema step 1).
import type { AppEnv, DbLoginRole } from "../config/schema.js";
import type { Logger } from "../observability/logger.js";
import { escapeIdentifier, escapeLiteral } from "./escape.js";
import { SchemaStepError } from "./schemaStepError.js";
import { withoutTracing } from "./suppressTracing.js";
import type { DbHandle } from "./types.js";

export const LOGIN_ROLES: readonly DbLoginRole[] = [
  "budmon_app",
  "budmon_capture",
  "budmon_queue",
  "budmon_monitor",
  "budmon_migrator",
];

const VERIFIER = /^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

export async function applyRolesAndPrivileges(
  migrator: DbHandle,
  secrets: Record<DbLoginRole, { verifier: string } | { password: string }>,
  appEnv: AppEnv,
  logger: Logger,
): Promise<void> {
  const production = appEnv === "production" || appEnv === "rehearsal";
  // Validate everything before any statement.
  for (const role of LOGIN_ROLES) {
    const secret = secrets[role];
    if ("verifier" in secret) {
      if (!VERIFIER.test(secret.verifier)) throw new SchemaStepError("invalid_verifier", role);
    } else if (production) {
      throw new SchemaStepError("password_form_in_production", role);
    }
  }

  // 0. Existing roles must not hold stronger attributes than expected; refuse, don't normalise.
  const existing = await migrator.executeSql(
    `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls
     FROM pg_roles WHERE rolname = ANY($1::text[])`,
    [[...LOGIN_ROLES]],
  );
  for (const row of existing.rows) {
    const role = String(row["rolname"]);
    const expected =
      row["rolcanlogin"] === true &&
      row["rolsuper"] === false &&
      row["rolcreatedb"] === false &&
      row["rolcreaterole"] === (role === "budmon_migrator") &&
      row["rolinherit"] === false &&
      row["rolreplication"] === false &&
      row["rolbypassrls"] === false;
    if (!expected) throw new SchemaStepError("role_attributes_unexpected", role);
  }

  // 1. Missing roles (budmon_migrator comes from F-14).
  for (const role of LOGIN_ROLES) {
    await migrator.executeSql(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} LOGIN NOINHERIT; END IF; END $$`,
    );
  }
  // 2. Memberships.
  await migrator.executeSql("GRANT budmon_queue TO budmon_migrator WITH SET TRUE, INHERIT FALSE");
  await migrator.executeSql("GRANT pg_monitor TO budmon_monitor WITH INHERIT TRUE");
  // 3. Passwords, with tracing suppressed and nothing but the role name logged.
  for (const role of LOGIN_ROLES) {
    const secret = secrets[role];
    const value = "verifier" in secret ? secret.verifier : secret.password;
    await withoutTracing(() =>
      migrator.executeSql(`ALTER ROLE ${escapeIdentifier(role)} PASSWORD ${escapeLiteral(value)}`),
    );
    logger.info("role_password_set", { role });
  }
  // 4. Database and schema privileges.
  const { rows } = await migrator.executeSql("SELECT current_database() AS name");
  const database = escapeIdentifier(String(rows[0]?.["name"]));
  await migrator.executeSql(
    `GRANT CONNECT ON DATABASE ${database} TO ${LOGIN_ROLES.map(escapeIdentifier).join(", ")}`,
  );
  await migrator.executeSql(
    "GRANT USAGE ON SCHEMA public TO budmon_app, budmon_capture, budmon_monitor",
  );
}
