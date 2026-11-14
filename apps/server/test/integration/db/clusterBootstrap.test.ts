// F-14 bootstrapCluster. TP-2.9 (fresh container), plus extra cases TP-2.51x for the rest of
// F-14's statements.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import {
  connectionString,
  query,
  startFreshPostgres,
  type FreshPostgres,
} from "../../support/postgres.js";

const DATABASE = "budmon";
const MIGRATOR_PASSWORD = "bootstrap-migrator-password";

let pg: FreshPostgres;

beforeAll(async () => {
  pg = await startFreshPostgres();
  for (let run = 0; run < 2; run += 1) {
    const client = await pg.superuserClient();
    try {
      await bootstrapCluster(client, {
        databaseName: DATABASE,
        migrator: { password: MIGRATOR_PASSWORD },
      });
    } finally {
      await client.end();
    }
  }
});

afterAll(async () => {
  await pg.stop();
});

async function superuserQuery(
  text: string,
  database = DATABASE,
): Promise<Record<string, unknown>[]> {
  return query(pg.superuserUrl(database), text);
}

describe("TP-2.9: bootstrapCluster run twice on a fresh container", () => {
  it("TP-2.9: the second run succeeds (both runs completed in beforeAll)", async () => {
    expect(await superuserQuery("SELECT 1 AS ok")).toEqual([{ ok: 1 }]);
  });

  it("TP-2.9: budmon_migrator owns the database", async () => {
    const rows = await superuserQuery(
      `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = '${DATABASE}'`,
    );

    expect(rows).toEqual([{ owner: "budmon_migrator" }]);
  });

  it("TP-2.9: CREATE on schema public is revoked from PUBLIC", async () => {
    const rows = await superuserQuery(
      `SELECT count(*)::int AS n FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
       WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'`,
    );

    expect(rows).toEqual([{ n: 0 }]);
  });
});

describe("TP-2.51x: the rest of F-14", () => {
  it("TP-2.51x: budmon_migrator is LOGIN CREATEROLE NOINHERIT and not a superuser", async () => {
    const rows = await superuserQuery(
      "SELECT rolcanlogin, rolcreaterole, rolinherit, rolsuper, rolcreatedb FROM pg_roles WHERE rolname = 'budmon_migrator'",
    );

    expect(rows).toEqual([
      {
        rolcanlogin: true,
        rolcreaterole: true,
        rolinherit: false,
        rolsuper: false,
        rolcreatedb: false,
      },
    ]);
  });

  it("TP-2.51x: budmon_migrator logs in with the given password", async () => {
    const url = connectionString(pg, "budmon_migrator", MIGRATOR_PASSWORD, DATABASE);

    expect(await query(url, "SELECT current_user AS u")).toEqual([{ u: "budmon_migrator" }]);
  });

  it("TP-2.51x: budmon_migrator owns schema public", async () => {
    expect(
      await superuserQuery(
        "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'public'",
      ),
    ).toEqual([{ owner: "budmon_migrator" }]);
  });

  it("TP-2.51x: PUBLIC has no privilege on the database", async () => {
    const rows = await superuserQuery(
      `SELECT count(*)::int AS n FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
       WHERE d.datname = '${DATABASE}' AND a.grantee = 0`,
    );

    expect(rows).toEqual([{ n: 0 }]);
  });

  it("TP-2.51x: amcheck is installed and budmon_migrator can execute bt_index_check", async () => {
    expect(
      await superuserQuery(
        "SELECT has_function_privilege('budmon_migrator', 'bt_index_check(regclass, boolean)', 'EXECUTE') AS can",
      ),
    ).toEqual([{ can: true }]);
  });

  it("TP-2.51x: pg_read_all_data is granted WITH INHERIT TRUE; pg_monitor WITH ADMIN, without INHERIT or SET", async () => {
    const rows = await superuserQuery(
      `SELECT r.rolname AS role, m.admin_option, m.inherit_option, m.set_option
       FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
       WHERE u.rolname = 'budmon_migrator' AND r.rolname IN ('pg_read_all_data', 'pg_monitor') ORDER BY r.rolname`,
    );

    expect(rows).toEqual([
      { role: "pg_monitor", admin_option: true, inherit_option: false, set_option: false },
      expect.objectContaining({ role: "pg_read_all_data", inherit_option: true }),
    ]);
  });
});
