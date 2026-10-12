// F-131: exchange_rates and currencies reads, and the day insert. Dates are `YYYY-MM-DD` strings
// and numeric values are read as strings.
import type { DbHandle } from "../db/types.js";

function dateOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function latestDayOnOrBefore(h: DbHandle, date: string): Promise<string | null> {
  const { rows } = await h.executeSql(
    "SELECT max(rate_date)::text AS d FROM exchange_rates WHERE rate_date <= $1::date",
    [date],
  );
  return dateOrNull(rows[0]?.["d"]);
}

export async function ratesOn(
  h: DbHandle,
  date: string,
  codes: readonly string[],
): Promise<Map<string, string>> {
  const { rows } = await h.executeSql(
    `SELECT currency_code AS code, units_per_usd::text AS rate
       FROM exchange_rates WHERE rate_date = $1::date AND currency_code = ANY($2::text[])`,
    [date, [...codes]],
  );
  return new Map(rows.map((r) => [String(r["code"]), String(r["rate"])]));
}

export async function dayExists(h: DbHandle, date: string): Promise<boolean> {
  const { rows } = await h.executeSql(
    "SELECT EXISTS (SELECT 1 FROM exchange_rates WHERE rate_date = $1::date) AS e",
    [date],
  );
  return rows[0]?.["e"] === true;
}

export async function nextStoredDayAfter(h: DbHandle, date: string): Promise<string | null> {
  const { rows } = await h.executeSql(
    "SELECT min(rate_date)::text AS d FROM exchange_rates WHERE rate_date > $1::date",
    [date],
  );
  return dateOrNull(rows[0]?.["d"]);
}

/** Inserts the day's rows; rows already stored are kept (stored days are final). */
export async function insertDay(
  h: DbHandle,
  rows: readonly { code: string; unitsPerUsd: string }[],
  rateDate: string,
  provider: string,
  fetchedAt: Date,
): Promise<number> {
  if (rows.length === 0) return 0;
  const { rowCount } = await h.executeSql(
    `INSERT INTO exchange_rates (currency_code, rate_date, units_per_usd, provider, fetched_at)
     SELECT code, $3::date, rate::numeric, $4, $5
       FROM unnest($1::text[], $2::text[]) AS t(code, rate)
     ON CONFLICT (currency_code, rate_date) DO NOTHING`,
    [rows.map((r) => r.code), rows.map((r) => r.unitsPerUsd), rateDate, provider, fetchedAt],
  );
  return rowCount;
}

export async function currencies(
  h: DbHandle,
): Promise<Map<string, { minorUnits: number; active: boolean }>> {
  const { rows } = await h.executeSql(
    "SELECT code, minor_units AS minor_units, is_active AS active FROM currencies",
  );
  return new Map(
    rows.map((r) => [
      String(r["code"]),
      {
        // smallint 0..4 (the table's check constraint); pg returns it as a JS number.
        minorUnits: typeof r["minor_units"] === "number" ? r["minor_units"] : -1,
        active: r["active"] === true,
      },
    ]),
  );
}
