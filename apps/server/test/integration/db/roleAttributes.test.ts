// F-15 refuses existing login roles with unexpected attributes (A-77). TP-2.10 (e) and (f), on a
// fresh container of their own: roles are cluster-wide, so these cases can't share roles.test.ts's.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import { applyRolesAndPrivileges } from "../../../src/platform/db/roles.js";
import { SchemaStepError } from "../../../src/platform/db/schemaStep.js";
import type { Database } from "../../../src/platform/db/types.js";
import { connectDatabase, recordingLogger } from "../../support/platform.js";
import {
  LOGIN_ROLES,
  query,
  startFreshPostgres,
  type FreshPostgres,
} from "../../support/postgres.js";

const DATABASE = "budmon";
const MIGRATOR_PASSWORD = "attributes-migrator-password";

type Secrets = Parameters<typeof applyRolesAndPrivileges>[1];

let pg: FreshPostgres;
let migrator: Database;

function secrets(): Secrets {
  const all = Object.fromEntries(
    LOGIN_ROLES.map((r) => [r, { password: "new-password" }]),
  ) as Secrets;
  all.budmon_migrator = { password: MIGRATOR_PASSWORD };
  return all;
}

async function superuser(text: string): Promise<Record<string, unknown>[]> {
  return query(pg.superuserUrl(DATABASE), text);
}

async function budmonRoles(): Promise<Record<string, unknown>[]> {
  return superuser(
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
  migrator = connectDatabase(pg, "budmon_migrator", MIGRATOR_PASSWORD, DATABASE);
});

afterAll(async () => {
  await migrator.close();
  await pg.stop();
});

beforeEach(async () => {
  // Only budmon_migrator (from F-14) exists before each case.
  for (const role of LOGIN_ROLES.filter((r) => r !== "budmon_migrator")) {
    await superuser(`DROP ROLE IF EXISTS ${role}`);
  }
});

describe("TP-2.10 (e)/(f): existing roles with unexpected attributes (A-77)", () => {
  it.each([
    ["(e) budmon_app pre-created LOGIN SUPERUSER", "budmon_app", "LOGIN SUPERUSER"],
    [
      "(f) budmon_queue pre-created LOGIN CREATEDB INHERIT",
      "budmon_queue",
      "LOGIN CREATEDB INHERIT",
    ],
  ])(
    "TP-2.10 %s: role_attributes_unexpected, no password changed and no role created",
    async (_label, role, attributes) => {
      await superuser(`CREATE ROLE ${role} ${attributes} PASSWORD 'original-password'`);
      const before = await budmonRoles();

      const error = await schemaStepError(
        applyRolesAndPrivileges(migrator.handle, secrets(), "test", recordingLogger()),
      );

      expect(error).toMatchObject({ code: "role_attributes_unexpected", subject: role });
      expect(await budmonRoles()).toEqual(before);
    },
  );

  it("TP-2.65x: an existing role with exactly the expected attributes is accepted (positive control)", async () => {
    // Created by budmon_migrator, as F-15 itself creates roles (so it holds ADMIN on it).
    await migrator.handle.executeSql(
      "CREATE ROLE budmon_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS",
    );

    await expect(
      applyRolesAndPrivileges(migrator.handle, secrets(), "test", recordingLogger()),
    ).resolves.toBeUndefined();
  });
});
