// TP-2.34: sql/cluster-bootstrap.sql through psql inside the Postgres container (A-75). The
// migrator password comes only from BUDMON_MIGRATOR_PASSWORD in psql's environment, so it never
// appears in argv; psql quotes it (`:'migrator_password'`).
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";
import {
  connectionString,
  query,
  startFreshPostgres,
  type FreshPostgres,
} from "../../support/postgres.js";

const SQL_FILE = path.join(SERVER_DIR, "src/platform/db/sql/cluster-bootstrap.sql");
const TARGET = "/tmp/cluster-bootstrap.sql";
const DATABASE = "budmon_boot";
const PASSWORD = `p'w"x\\y`;

let pg: FreshPostgres;

function psql(): string[] {
  return [
    "psql",
    "-U",
    pg.superuserName,
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    `dbname=${DATABASE}`,
    "-f",
    TARGET,
  ];
}

async function databaseExists(): Promise<boolean> {
  const rows = await query(pg.superuserUrl(), "SELECT 1 FROM pg_database WHERE datname = $1", [
    DATABASE,
  ]);
  return rows.length === 1;
}

beforeAll(async () => {
  pg = await startFreshPostgres();
  await pg.copyFile(SQL_FILE, TARGET);
});

afterAll(async () => {
  await pg.stop();
});

describe("TP-2.34: cluster-bootstrap.sql through psql", () => {
  it("TP-2.34 (b): without BUDMON_MIGRATOR_PASSWORD it exits non-zero before changing anything", async () => {
    const result = await pg.exec(psql());

    expect(result.exitCode, result.output).not.toBe(0);
    expect(await databaseExists()).toBe(false);
    expect(
      await query(pg.superuserUrl(), "SELECT 1 FROM pg_roles WHERE rolname = 'budmon_migrator'"),
    ).toEqual([]);
  });

  it("TP-2.34 (a): with the password in the environment it succeeds, and the migrator logs in", async () => {
    const command = psql();

    const result = await pg.exec(command, { BUDMON_MIGRATOR_PASSWORD: PASSWORD });

    expect(result.exitCode, result.output).toBe(0);
    expect(command.join(" ")).not.toContain(PASSWORD);
    expect(
      await query(
        connectionString(pg, "budmon_migrator", PASSWORD, DATABASE),
        "SELECT current_user AS u, current_database() AS d",
      ),
    ).toEqual([{ u: "budmon_migrator", d: DATABASE }]);
    expect(
      await query(
        pg.superuserUrl(),
        "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1",
        [DATABASE],
      ),
    ).toEqual([{ owner: "budmon_migrator" }]);
  });

  it("TP-2.66x: a second run with the same password succeeds (idempotent)", async () => {
    const result = await pg.exec(psql(), { BUDMON_MIGRATOR_PASSWORD: PASSWORD });

    expect(result.exitCode, result.output).toBe(0);
  });

  it("TP-2.66x: the script leaves the same privileges as bootstrapCluster (CREATE on public revoked, amcheck usable)", async () => {
    const [row] = await query(
      pg.superuserUrl(DATABASE),
      `SELECT pg_get_userbyid(n.nspowner) AS owner,
              has_function_privilege('budmon_migrator', 'bt_index_check(regclass, boolean)', 'EXECUTE') AS amcheck,
              (SELECT count(*)::int FROM aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
               WHERE a.grantee = 0 AND a.privilege_type = 'CREATE') AS public_create
       FROM pg_namespace n WHERE n.nspname = 'public'`,
    );

    expect(row).toEqual({ owner: "budmon_migrator", amcheck: true, public_create: 0 });
  });
});
