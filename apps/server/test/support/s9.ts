// S-9 test support (FX rates and conversion), owned by the test-architect: data helpers for
// exchange_rates and pgboss.job, and a fake FxProvider.
import type { Database } from "../../src/platform/db/types.js";
import type { FxProvider, FxProviderName } from "../../src/platform/fx/providers.js";
import { query } from "./postgres.js";
import type { TestDatabase } from "./testDatabase.js";

// ---- data helpers ----

/** Inserts rates for `rateDate` as budmon_migrator (independent of F-131). */
export async function storeDay(
  testDb: TestDatabase,
  rateDate: string,
  rates: Record<string, string>,
  provider: FxProviderName = "fixed",
): Promise<void> {
  for (const [code, unitsPerUsd] of Object.entries(rates)) {
    await query(
      testDb.urlAs("budmon_migrator"),
      "INSERT INTO exchange_rates (currency_code, rate_date, units_per_usd, provider, fetched_at) VALUES ($1, $2, $3, $4, now())",
      [code, rateDate, unitsPerUsd, provider],
    );
  }
}

/** Every exchange_rates row, as strings, ordered by date then code. */
export async function storedRates(
  testDb: TestDatabase,
): Promise<{ code: string; rateDate: string; unitsPerUsd: string; provider: string }[]> {
  const rows = await query<{
    code: string;
    rate_date: string;
    units_per_usd: string;
    provider: string;
  }>(
    testDb.urlAs("budmon_migrator"),
    "SELECT currency_code AS code, rate_date::text AS rate_date, units_per_usd::text AS units_per_usd, provider FROM exchange_rates ORDER BY rate_date, currency_code",
  );
  return rows.map((r) => ({
    code: r.code,
    rateDate: r.rate_date,
    unitsPerUsd: r.units_per_usd,
    provider: r.provider,
  }));
}

/** pgboss.job rows for `name`: data and singleton key, oldest first. */
export async function queuedJobs(
  testDb: TestDatabase,
  name: string,
): Promise<{ data: unknown; singletonKey: string | null; state: string }[]> {
  const rows = await query<{ data: unknown; singleton_key: string | null; state: string }>(
    testDb.urlAs("budmon_queue"),
    "SELECT data, singleton_key, state::text AS state FROM pgboss.job WHERE name = $1 ORDER BY created_on, id",
    [name],
  );
  return rows.map((r) => ({ data: r.data, singletonKey: r.singleton_key, state: r.state }));
}

/** A fake FxProvider whose fetchDay answers from `answer` and records the dates asked. */
export function fakeProvider(
  name: FxProviderName,
  answer: (date: string) => Promise<Map<string, string>>,
): FxProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    fetchDay: (date: string) => {
      calls.push(date);
      return answer(date);
    },
  };
}

/**
 * `db` with a hook: before the first statement whose text matches `match`, `before()` runs once
 * (another connection's change between a check and a write; A-245's pattern). Covers the pool's
 * clients, `pool.query` and `handle.executeSql`.
 */
export function beforeStatement(
  db: Database,
  match: RegExp,
  before: () => Promise<void>,
): Database {
  let fired = false;
  const hook = async (text: unknown): Promise<void> => {
    const inner = typeof text === "string" ? undefined : (text as { text?: unknown }).text;
    const sql = typeof text === "string" ? text : typeof inner === "string" ? inner : "";
    if (!fired && match.test(sql)) {
      fired = true;
      await before();
    }
  };
  const wrapClient = <C extends { query: (...args: never[]) => unknown }>(client: C): C =>
    new Proxy(client, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return async (text: unknown, values?: unknown) => {
            await hook(text);
            return (target.query as (...a: unknown[]) => unknown).call(target, text, values);
          };
        }
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === "function"
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  const pool = new Proxy(db.pool, {
    get(target, prop, receiver) {
      if (prop === "connect") return async () => wrapClient(await target.connect());
      if (prop === "query") {
        return async (text: unknown, values?: unknown) => {
          await hook(text);
          return (target.query as (...a: unknown[]) => unknown).call(target, text, values);
        };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  const handle = new Proxy(db.handle, {
    get(target, prop, receiver) {
      if (prop === "executeSql") {
        return async (text: string, values?: readonly unknown[]) => {
          await hook(text);
          return target.executeSql(text, values);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
  return { ...db, pool, handle, close: () => db.close() };
}
