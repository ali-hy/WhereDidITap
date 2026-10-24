// F-19 runSchemaStep, S-2 shape (A-49, A-50), on a fresh container. TP-2.15, plus extra cases
// TP-2.55x. S-6 extends TP-2.15 with the queue fields. TP-2.15 (d) and (e) (A-179) run the built
// migrate process for its exit code, in test/integration/main/apiBundle.test.ts.
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import { PushTargetNotEmptyError } from "../../../src/platform/db/schemaPush.js";
import { runSchemaStep } from "../../../src/platform/db/schemaStep.js";
import type { Database } from "../../../src/platform/db/types.js";
import {
  SERVER_DIR,
  connectDatabase,
  recordingLogger,
  schemaStepInput,
  type LoggedLine,
} from "../../support/platform.js";
import {
  TEST_ROLE_PASSWORDS,
  query,
  startFreshPostgres,
  type FreshPostgres,
} from "../../support/postgres.js";

const DATABASE = "budmon";
const EMPTY_MIGRATIONS = path.join(SERVER_DIR, "test/fixtures/migrations-empty");
const NO_JOURNAL = path.join(SERVER_DIR, "test/fixtures/migrations-no-journal");

let pg: FreshPostgres;
let migrator: Database;
const firstRun: LoggedLine[] = [];
let report: Awaited<ReturnType<typeof runSchemaStep>>;

beforeAll(async () => {
  pg = await startFreshPostgres();
  const client = await pg.superuserClient();
  try {
    await bootstrapCluster(client, {
      databaseName: DATABASE,
      migrator: { password: TEST_ROLE_PASSWORDS.budmon_migrator },
    });
  } finally {
    await client.end();
  }
  migrator = connectDatabase(pg, "budmon_migrator", TEST_ROLE_PASSWORDS.budmon_migrator, DATABASE);
  report = await runSchemaStep(schemaStepInput(migrator, "push", recordingLogger(firstRun)));
});

afterAll(async () => {
  await migrator.close();
  await pg.stop();
});

function stepFields(lines: LoggedLine[]): { step?: unknown; durationMs?: unknown }[] {
  return lines
    .filter((l) => l.event === "schema_step")
    .map((l) => (l.fields as { fields?: { step?: unknown; durationMs?: unknown } }).fields ?? {});
}

describe("TP-2.15: runSchemaStep (S-2)", () => {
  it("TP-2.15 (a): push on an empty database reports pushed statements and upserted currencies", () => {
    // S-6 (A-49): the three queue fields.
    expect(Object.keys(report).sort()).toEqual([
      "currenciesUpserted",
      "migrationsApplied",
      "pushedStatements",
      "queueSchema",
      "queuesCreated",
      "queuesUpdated",
    ]);
    expect(report.migrationsApplied).toBe(0);
    expect(report.pushedStatements).toBeGreaterThan(0);
    expect(report.currenciesUpserted).toBeGreaterThan(0);
    expect(report).toMatchObject({ queueSchema: "installed" });
    expect((report as unknown as { queuesCreated: number }).queuesCreated).toBeGreaterThan(0);
  });

  it("TP-2.15 (b): push again throws PushTargetNotEmptyError after step 1 re-ran without error", async () => {
    const lines: LoggedLine[] = [];

    await expect(
      runSchemaStep(schemaStepInput(migrator, "push", recordingLogger(lines))),
    ).rejects.toBeInstanceOf(PushTargetNotEmptyError);
    expect(lines.filter((l) => l.event === "role_password_set")).toHaveLength(5);
  });

  it("TP-2.15 (c): migrate mode with an empty migrations folder applies nothing and upserts nothing", async () => {
    const second = await runSchemaStep(
      schemaStepInput(migrator, "migrate", recordingLogger(), EMPTY_MIGRATIONS),
    );

    expect(second).toMatchObject({ migrationsApplied: 0, currenciesUpserted: 0 });
    // S-6 (A-49): the queue schema is current and every queue exists already.
    expect(second).toMatchObject({ queueSchema: "current", queuesCreated: 0 });
  });
});

describe("TP-2.15 (f): an empty journal on a pushed database runs every step (A-204)", () => {
  it("TP-2.15 (f): migrate mode with no journal at all on the pushed database reports as (c)", async () => {
    const lines: LoggedLine[] = [];

    const third = await runSchemaStep(
      schemaStepInput(migrator, "migrate", recordingLogger(lines), NO_JOURNAL),
    );

    expect(third).toMatchObject({
      migrationsApplied: 0,
      currenciesUpserted: 0,
      queueSchema: "current",
      queuesCreated: 0,
    });
    // Every step ran: the tables exist, so the fresh-database path (A-179, A-204) doesn't apply.
    const steps = new Set(stepFields(lines).map((f) => f.step));
    expect(steps.size).toBeGreaterThanOrEqual(6);
  });
});

describe("TP-2.55x: the rest of F-19", () => {
  it("TP-2.55x: roles, tables, grants and reference data are all in place", async () => {
    const url = pg.superuserUrl(DATABASE);
    const [roles] = await query(
      url,
      "SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('budmon_app','budmon_capture','budmon_queue','budmon_monitor')",
    );
    const [tables] = await query(
      url,
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
    );
    const [grant] = await query(
      url,
      "SELECT has_table_privilege('budmon_app', 'public.currencies', 'SELECT') AS can",
    );
    const [egp] = await query(url, "SELECT minor_units FROM currencies WHERE code = 'EGP'");

    expect(roles).toEqual({ n: 4 });
    expect(tables).toEqual({ n: 4 });
    expect(grant).toEqual({ can: true });
    expect(egp).toEqual({ minor_units: 2 });
  });

  it('TP-2.55x: each step is logged once as event "schema_step" with step and durationMs', () => {
    const fields = stepFields(firstRun);

    expect(fields.length).toBeGreaterThanOrEqual(4);
    for (const f of fields) {
      expect(typeof f.step).toBe("string");
      expect(typeof f.durationMs).toBe("number");
    }
    expect(new Set(fields.map((f) => f.step)).size).toBe(fields.length);
  });
});
