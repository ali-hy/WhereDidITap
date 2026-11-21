// F-7 identityGrants and P-F-16 (identity LLD §3.2). TP-0.9, plus extra cases TP-0.9x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it, vi } from "vitest";
import { applyTableGrants, tableGrants, type TableGrant } from "../../../src/platform/db/grants.js";
import { SchemaStepError } from "../../../src/platform/db/schemaStepError.js";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { identityGrants } from "../../../src/identity/identityGrants.js";

const ALL = ["DELETE", "INSERT", "SELECT", "UPDATE"];

const CREDENTIAL_TABLES = [
  "password_credentials",
  "google_identities",
  "two_step_credentials",
  "recovery_codes",
  "sessions",
  "session_refresh_tokens",
  "known_devices",
  "auth_challenges",
  "password_resets",
  "invitations",
];
const PLAIN_TABLES = ["email_bans", "identity_settings", "security_events", "data_exports"];

/** A migrator handle whose pg_tables lists `tables`; any other statement is recorded. */
function fakeMigrator(tables: readonly string[]): { handle: DbHandle; statements: string[] } {
  const statements: string[] = [];
  const executeSql = vi.fn((text: string) => {
    if (text.includes("FROM pg_tables")) {
      return Promise.resolve({
        rows: tables.map((tablename) => ({ tablename })),
        rowCount: tables.length,
      });
    }
    statements.push(text);
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { handle: { executeSql, inTransaction: false } as unknown as DbHandle, statements };
}

function sorted(g: TableGrant | undefined): unknown {
  return g === undefined
    ? undefined
    : { app: [...g.app].sort(), capture: [...g.capture].sort(), credential: g.credential };
}

describe("TP-0.9: a credential table granted to capture is refused", () => {
  it("TP-0.9: identityGrants with sessions.capture = ['SELECT'] → SchemaStepError credential_table_granted_to_capture (sessions), before any statement", async () => {
    const grants = {
      ...tableGrants,
      sessions: { ...(identityGrants["sessions"] as TableGrant), capture: ["SELECT"] as const },
    };
    const { handle, statements } = fakeMigrator(Object.keys(grants));

    const error = await applyTableGrants(handle, grants).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SchemaStepError);
    expect(error).toMatchObject({
      code: "credential_table_granted_to_capture",
      subject: "sessions",
    });
    expect(statements).toEqual([]);
  });
});

describe("TP-0.9x: identityGrants is §3.2's table", () => {
  it("TP-0.9x: exactly identity's 15 tables", () => {
    expect(Object.keys(identityGrants).sort()).toEqual(
      ["users", ...CREDENTIAL_TABLES, ...PLAIN_TABLES].sort(),
    );
  });

  it("TP-0.9x: users: all four for budmon_app, SELECT for capture (DV-4), not a credential", () => {
    expect(sorted(identityGrants["users"])).toEqual({
      app: ALL,
      capture: ["SELECT"],
      credential: false,
    });
  });

  it.each(CREDENTIAL_TABLES)(
    "TP-0.9x: %s is a credential table: all four for app, none for capture",
    (t) => {
      expect(sorted(identityGrants[t])).toEqual({ app: ALL, capture: [], credential: true });
    },
  );

  it.each(PLAIN_TABLES)(
    "TP-0.9x: %s: all four for app, none for capture, not a credential",
    (t) => {
      expect(sorted(identityGrants[t])).toEqual({ app: ALL, capture: [], credential: false });
    },
  );

  it("TP-0.9x: tableGrants spreads identityGrants (P-F-16's map holds each identity entry)", () => {
    for (const [table, grant] of Object.entries(identityGrants)) {
      expect(tableGrants[table]).toEqual(grant);
    }
  });
});
