// F-14: idempotent cluster bootstrap. The same statements, as a psql script, are in
// sql/cluster-bootstrap.sql for the Postgres image's first-setup script (F-170).
import pg from "pg";
import { escapeIdentifier, escapeLiteral } from "./escape.js";
import { withoutTracing } from "./suppressTracing.js";

export type RoleSecret = { verifier: string } | { password: string };

/** `ALTER ROLE … PASSWORD`, built client-side: utility statements take no bind parameters. */
export function alterRolePassword(role: string, secret: RoleSecret): string {
  const value = "verifier" in secret ? secret.verifier : secret.password;
  return `ALTER ROLE ${escapeIdentifier(role)} PASSWORD ${escapeLiteral(value)}`;
}

export async function bootstrapCluster(
  superuser: pg.Client,
  input: { databaseName: string; migrator: RoleSecret },
): Promise<void> {
  const migrator = "budmon_migrator";
  const database = superuser.escapeIdentifier(input.databaseName);

  const role = await superuser.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [migrator]);
  if (role.rowCount === 0) {
    await superuser.query(`CREATE ROLE ${migrator} LOGIN CREATEROLE NOINHERIT`);
  }
  await withoutTracing(() => superuser.query(alterRolePassword(migrator, input.migrator)));

  const exists = await superuser.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    input.databaseName,
  ]);
  if (exists.rowCount === 0) {
    await superuser.query(`CREATE DATABASE ${database} OWNER ${migrator}`);
  }
  await superuser.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);

  const inDatabase = new pg.Client({
    host: superuser.host,
    port: superuser.port,
    user: superuser.user,
    password: superuser.password,
    ssl: superuser.ssl,
    database: input.databaseName,
  });
  await inDatabase.connect();
  try {
    await inDatabase.query(`ALTER SCHEMA public OWNER TO ${migrator}`);
    await inDatabase.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await inDatabase.query("CREATE EXTENSION IF NOT EXISTS amcheck");
    await inDatabase.query(
      `GRANT EXECUTE ON FUNCTION bt_index_check(regclass, boolean) TO ${migrator}`,
    );
    await inDatabase.query(`GRANT pg_read_all_data TO ${migrator} WITH INHERIT TRUE`);
    await inDatabase.query(
      `GRANT pg_monitor TO ${migrator} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
    );
  } finally {
    await inDatabase.end();
  }
}
