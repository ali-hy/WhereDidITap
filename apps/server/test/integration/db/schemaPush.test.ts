// F-17 pushSchemaOntoEmpty. TP-2.12 (fresh container), plus extra cases TP-2.53x for §3.1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import {
  PushTargetNotEmptyError,
  pushSchemaOntoEmpty,
} from "../../../src/platform/db/schemaPush.js";
import type { Database } from "../../../src/platform/db/types.js";
import { connectDatabase } from "../../support/platform.js";
import { query, startFreshPostgres, type FreshPostgres } from "../../support/postgres.js";

const DATABASE = "budmon";
const MIGRATOR_PASSWORD = "push-migrator-password";

let pg: FreshPostgres;
let migrator: Database;
let firstPush: { statements: number };

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
  firstPush = await pushSchemaOntoEmpty(migrator.handle);
});

afterAll(async () => {
  await migrator.close();
  await pg.stop();
});

async function rows(text: string): Promise<Record<string, unknown>[]> {
  return query(pg.superuserUrl(DATABASE), text);
}

describe("TP-2.12: push onto an empty database", () => {
  it("TP-2.12: creates the four platform tables", async () => {
    expect(firstPush.statements).toBeGreaterThan(0);
    expect(
      await rows("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"),
    ).toEqual([
      { tablename: "currencies" },
      { tablename: "exchange_rates" },
      { tablename: "idempotency_records" },
      { tablename: "rate_limit_counters" },
    ]);
  });

  it("TP-2.12: rate_limit_counters is UNLOGGED (relpersistence u)", async () => {
    expect(
      await rows(
        "SELECT relpersistence FROM pg_class WHERE oid = 'public.rate_limit_counters'::regclass",
      ),
    ).toEqual([{ relpersistence: "u" }]);
  });

  it("TP-2.12: a non-empty target throws PushTargetNotEmptyError naming its tables", async () => {
    let caught: unknown;
    try {
      await pushSchemaOntoEmpty(migrator.handle);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PushTargetNotEmptyError);
    expect((caught as Error).message).toContain("currencies");
  });
});

describe("TP-2.53x: the pushed schema matches §3.1", () => {
  it("TP-2.53x: the tables belong to budmon_migrator", async () => {
    expect(
      await rows("SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'"),
    ).toEqual([{ tableowner: "budmon_migrator" }]);
  });

  it("TP-2.53x: §3.1's check constraints and indexes exist", async () => {
    const checks = await rows(
      "SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace ORDER BY conname",
    );
    const indexes = await rows(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%\\_idx' ORDER BY indexname",
    );

    expect(checks.map((r) => r["conname"])).toEqual(
      expect.arrayContaining([
        "currencies_code_format",
        "currencies_minor_units_range",
        "exchange_rates_positive",
        "exchange_rates_provider",
        "idempotency_records_hash_len",
      ]),
    );
    expect(indexes.map((r) => r["indexname"])).toEqual([
      "exchange_rates_rate_date_idx",
      "idempotency_records_expires_at_idx",
      "rate_limit_counters_expires_at_idx",
    ]);
  });

  it("TP-2.53x: columns are snake_case with §3.1's types", async () => {
    const columns = await rows(
      `SELECT table_name || '.' || column_name || ':' || data_type AS c FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'exchange_rates' ORDER BY ordinal_position`,
    );

    expect(columns.map((r) => r["c"])).toEqual([
      "exchange_rates.currency_code:character",
      "exchange_rates.rate_date:date",
      "exchange_rates.units_per_usd:numeric",
      "exchange_rates.provider:text",
      "exchange_rates.fetched_at:timestamp with time zone",
      "exchange_rates.created_at:timestamp with time zone",
      "exchange_rates.updated_at:timestamp with time zone",
    ]);
  });

  it("TP-2.53x: exchange_rates.currency_code references currencies with RESTRICT on delete and update", async () => {
    expect(
      await rows(
        "SELECT confdeltype, confupdtype FROM pg_constraint WHERE contype = 'f' AND conrelid = 'public.exchange_rates'::regclass",
      ),
    ).toEqual([{ confdeltype: "r", confupdtype: "r" }]);
  });
});
