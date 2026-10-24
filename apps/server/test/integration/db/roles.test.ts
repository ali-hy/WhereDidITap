// F-15 applyRolesAndPrivileges. TP-2.10 (fresh container), plus extra cases TP-2.52x.
// The span check of TP-2.10 (a) is TP-3.12 in S-3 (A-51).
import { CANARIES } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import { applyRolesAndPrivileges } from "../../../src/platform/db/roles.js";
import { SchemaStepError } from "../../../src/platform/db/schemaStep.js";
import type { Database } from "../../../src/platform/db/types.js";
import { connectDatabase, recordingLogger, type LoggedLine } from "../../support/platform.js";
import {
  LOGIN_ROLES,
  connectionString,
  query,
  startFreshPostgres,
  type FreshPostgres,
  type LoginRole,
} from "../../support/postgres.js";
import { testScramVerifier } from "../../support/scram.js";

const DATABASE = "budmon";
const MIGRATOR_PASSWORD = "roles-migrator-password";
// F-198's canary token.
const CANARY_TOKEN = CANARIES.token;

type Secrets = Parameters<typeof applyRolesAndPrivileges>[1];

let pg: FreshPostgres;
let migrator: Database;
const firstRunLines: LoggedLine[] = [];

/** `password` for every role except budmon_migrator, which keeps the password the test logs in
 * with (F-15 sets the migrator's password too). */
function passwordSecrets(password: string): Secrets {
  const secrets = Object.fromEntries(LOGIN_ROLES.map((r) => [r, { password }])) as Secrets;
  secrets.budmon_migrator = { password: MIGRATOR_PASSWORD };
  return secrets;
}

async function superuserQuery(
  text: string,
  values: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  return query(pg.superuserUrl(DATABASE), text, values);
}

async function rolePasswords(): Promise<Record<string, unknown>[]> {
  return superuserQuery(
    "SELECT rolname, rolpassword FROM pg_authid WHERE rolname LIKE 'budmon\\_%' ORDER BY rolname",
  );
}

async function schemaStepError(operation: Promise<unknown>): Promise<SchemaStepError> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof SchemaStepError) return error;
    throw error;
  }
  throw new Error("expected a SchemaStepError");
}

beforeAll(async () => {
  pg = await startFreshPostgres();
  const client = await pg.superuserClient();
  try {
    await bootstrapCluster(client, {
      databaseName: DATABASE,
      migrator: { password: MIGRATOR_PASSWORD },
    });
  } finally {
    await client.end();
  }
  await superuserQuery("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  await superuserQuery("SELECT pg_stat_statements_reset()");
  migrator = connectDatabase(pg, "budmon_migrator", MIGRATOR_PASSWORD, DATABASE);
  // (a) runs first: every later case depends on the roles existing.
  await applyRolesAndPrivileges(
    migrator.handle,
    passwordSecrets(CANARY_TOKEN),
    "test",
    recordingLogger(firstRunLines),
  );
});

afterAll(async () => {
  await migrator.close();
  await pg.stop();
});

describe("TP-2.10: roles and passwords", () => {
  it("TP-2.10 (a): every login role exists, NOINHERIT", async () => {
    const rows = await superuserQuery(
      "SELECT rolname, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname",
      [[...LOGIN_ROLES]],
    );

    expect(rows).toEqual(
      [...LOGIN_ROLES].sort().map((rolname) => ({ rolname, rolcanlogin: true, rolinherit: false })),
    );
  });

  it("TP-2.10 (a): one role_password_set per role, naming only the role", () => {
    const events = firstRunLines.filter((l) => l.event === "role_password_set");

    expect(events.map((l) => l.level)).toEqual(LOGIN_ROLES.map(() => "info"));
    expect(
      events.map((l) => (l.fields as { fields?: { role?: unknown } }).fields?.role).sort(),
    ).toEqual([...LOGIN_ROLES].sort());
  });

  it("TP-2.10 (a): the canary password is in no log call", () => {
    expect(JSON.stringify(firstRunLines)).not.toContain(CANARY_TOKEN);
  });

  it("TP-2.10 (a): the canary password is in no pg_stat_statements query", async () => {
    // Positive control (code review N-2): an ordinary query is recorded, so an empty view can't
    // make the check below pass.
    await query(
      connectionString(pg, "budmon_migrator", MIGRATOR_PASSWORD, DATABASE),
      "SELECT count(*) FROM pg_class AS pgss_control_7f3a",
    );
    const control = await superuserQuery(
      "SELECT count(*)::int AS n FROM pg_stat_statements WHERE query LIKE '%pgss_control_7f3a%'",
    );
    expect(control).toEqual([{ n: 1 }]);

    const rows = await superuserQuery(
      "SELECT count(*)::int AS n FROM pg_stat_statements WHERE query LIKE '%' || $1 || '%'",
      [CANARY_TOKEN],
    );

    expect(rows).toEqual([{ n: 0 }]);
  });

  it("TP-2.10 (a): each role logs in with its password-form password", async () => {
    for (const role of [
      "budmon_app",
      "budmon_capture",
      "budmon_queue",
      "budmon_monitor",
    ] as LoginRole[]) {
      const url = connectionString(pg, role, CANARY_TOKEN, DATABASE);
      expect(await query(url, "SELECT current_user AS u")).toEqual([{ u: role }]);
    }
  });

  it("TP-2.10 (b): with a verifier for budmon_app, budmon_app logs in with that password", async () => {
    const secrets = passwordSecrets(CANARY_TOKEN);
    secrets.budmon_app = { verifier: testScramVerifier("app-password-from-verifier") };

    await applyRolesAndPrivileges(migrator.handle, secrets, "test", recordingLogger());

    const url = connectionString(pg, "budmon_app", "app-password-from-verifier", DATABASE);
    expect(await query(url, "SELECT current_user AS u")).toEqual([{ u: "budmon_app" }]);
  });

  it('TP-2.10 (c): verifier "SCRAM-SHA-256$bad" throws invalid_verifier for budmon_app and alters no role', async () => {
    const before = await rolePasswords();
    const secrets = passwordSecrets("changed-password");
    secrets.budmon_app = { verifier: "SCRAM-SHA-256$bad" };

    const error = await schemaStepError(
      applyRolesAndPrivileges(migrator.handle, secrets, "test", recordingLogger()),
    );

    expect(error).toMatchObject({ code: "invalid_verifier", subject: "budmon_app" });
    expect(error.name).toBe("SchemaStepError");
    expect(error.message).toBe("schema step failed: invalid_verifier (budmon_app)");
    expect(await rolePasswords()).toEqual(before);
  });

  it("TP-2.10 (d): a password form with appEnv production throws password_form_in_production", async () => {
    const before = await rolePasswords();

    const error = await schemaStepError(
      applyRolesAndPrivileges(
        migrator.handle,
        passwordSecrets("prod-password"),
        "production",
        recordingLogger(),
      ),
    );

    expect(error.code).toBe("password_form_in_production");
    expect(LOGIN_ROLES).toContain(error.subject);
    expect(await rolePasswords()).toEqual(before);
  });
});

describe("TP-2.52x: the rest of F-15", () => {
  it("TP-2.52x: budmon_queue is granted to budmon_migrator WITH SET TRUE, INHERIT FALSE", async () => {
    const rows = await superuserQuery(
      `SELECT m.set_option, m.inherit_option FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
       WHERE r.rolname = 'budmon_queue' AND u.rolname = 'budmon_migrator'`,
    );

    // Postgres 16+ also records CREATE ROLE's implicit admin grant to the creating role.
    expect(rows).toContainEqual({ set_option: true, inherit_option: false });
    expect(rows.filter((r) => r["inherit_option"] === true)).toEqual([]);
  });

  it("TP-2.52x: budmon_monitor is a member of pg_monitor WITH INHERIT TRUE", async () => {
    const rows = await superuserQuery(
      `SELECT m.inherit_option FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
       WHERE r.rolname = 'pg_monitor' AND u.rolname = 'budmon_monitor'`,
    );

    expect(rows).toEqual([{ inherit_option: true }]);
  });

  it("TP-2.52x: every login role has CONNECT; app, capture and monitor have USAGE on public", async () => {
    const rows = await superuserQuery(
      `SELECT r AS role, has_database_privilege(r, $1, 'CONNECT') AS connect, has_schema_privilege(r, 'public', 'USAGE') AS usage
       FROM unnest($2::text[]) AS r ORDER BY r`,
      [DATABASE, ["budmon_app", "budmon_capture", "budmon_monitor", "budmon_queue"]],
    );

    expect(rows).toEqual([
      { role: "budmon_app", connect: true, usage: true },
      { role: "budmon_capture", connect: true, usage: true },
      { role: "budmon_monitor", connect: true, usage: true },
      expect.objectContaining({ role: "budmon_queue", connect: true }),
    ]);
  });

  it("TP-2.52x: a second identical run succeeds (idempotent)", async () => {
    await expect(
      applyRolesAndPrivileges(
        migrator.handle,
        passwordSecrets(CANARY_TOKEN),
        "test",
        recordingLogger(),
      ),
    ).resolves.toBeUndefined();
  });
});
