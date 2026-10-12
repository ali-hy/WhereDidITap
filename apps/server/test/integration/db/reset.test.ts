// F-20 resetDevelopmentDatabase on a fresh container. TP-2.16 (b) (A-54), plus extra case
// TP-2.56x. The refusals, TP-2.16 (a), are unit tests (unit/db/reset.test.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetDevelopmentDatabase } from "../../../src/platform/db/reset.js";
import { runSchemaStep } from "../../../src/platform/db/schemaStep.js";
import {
  TEST_ROLE_PASSWORDS,
  query,
  startFreshPostgres,
  testRoleSecrets,
  type FreshPostgres,
} from "../../support/postgres.js";

const DATABASE = "budmon_reset_test";

let pg: FreshPostgres;

beforeAll(async () => {
  pg = await startFreshPostgres();
});

afterAll(async () => {
  await pg.stop();
});

function input(seed: boolean): Parameters<typeof resetDevelopmentDatabase>[0] {
  return {
    appEnv: "development",
    superuserUrl: pg.superuserUrl("postgres"),
    databaseName: DATABASE,
    migratorPassword: TEST_ROLE_PASSWORDS.budmon_migrator,
    roleSecrets: testRoleSecrets(),
    seed,
    // The container's host may not be one of F-20's local names (A-79).
    allowNonLocalHost: true,
  };
}

/** The real runSchemaStep and a seed closure, both recording into `calls`. */
function spiedDeps(calls: string[]): {
  runSchemaStep: typeof runSchemaStep;
  seed: () => Promise<void>;
  schemaStepSpy: ReturnType<typeof vi.fn>;
  seedSpy: ReturnType<typeof vi.fn>;
} {
  const schemaStepSpy = vi.fn((schemaInput: Parameters<typeof runSchemaStep>[0]) => {
    calls.push(`runSchemaStep:${schemaInput.mode}`);
    return runSchemaStep(schemaInput);
  });
  const seedSpy = vi.fn(() => {
    calls.push("seed");
    return Promise.resolve();
  });
  return {
    runSchemaStep: schemaStepSpy,
    seed: seedSpy,
    schemaStepSpy,
    seedSpy,
  };
}

async function publicTables(): Promise<string[]> {
  const rows = await query(
    pg.superuserUrl(DATABASE),
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return rows.map((r) => String(r["tablename"]));
}

describe("TP-2.16 (b): resetDevelopmentDatabase on a local development database", () => {
  it("TP-2.16 (b): the old database is dropped, the schema pushed, then seed called once", async () => {
    await query(pg.superuserUrl("postgres"), `CREATE DATABASE ${DATABASE}`);
    await query(pg.superuserUrl(DATABASE), "CREATE TABLE marker (id int)");
    const calls: string[] = [];
    const deps = spiedDeps(calls);

    await resetDevelopmentDatabase(input(true), {
      runSchemaStep: deps.runSchemaStep,
      seed: deps.seed,
    });

    expect(calls).toEqual(["runSchemaStep:push", "seed"]);
    expect(deps.schemaStepSpy).toHaveBeenCalledTimes(1);
    expect(deps.seedSpy).toHaveBeenCalledTimes(1);
    expect(await publicTables()).toEqual([
      "currencies",
      "exchange_rates",
      "idempotency_records",
      "rate_limit_counters",
    ]);
  });

  it("TP-2.16 (b): with seed false, seed isn't called", async () => {
    const calls: string[] = [];
    const deps = spiedDeps(calls);

    await resetDevelopmentDatabase(input(false), {
      runSchemaStep: deps.runSchemaStep,
      seed: deps.seed,
    });

    expect(calls).toEqual(["runSchemaStep:push"]);
    expect(deps.seedSpy).not.toHaveBeenCalled();
  });

  it("TP-2.56x: an open connection to the database doesn't stop the reset", async () => {
    const pgModule = await import("pg");
    const holder = new pgModule.default.Client({ connectionString: pg.superuserUrl(DATABASE) });
    await holder.connect();
    holder.on("error", () => undefined);
    const calls: string[] = [];
    const deps = spiedDeps(calls);

    await resetDevelopmentDatabase(input(false), {
      runSchemaStep: deps.runSchemaStep,
      seed: deps.seed,
    });

    expect(calls).toEqual(["runSchemaStep:push"]);
    await holder.end().catch(() => undefined);
  });
});
