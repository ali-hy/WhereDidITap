// F-21: loads the ISO 4217 reference data (schema step 5).
import { SchemaStepError } from "./schemaStepError.js";
import type { DbHandle } from "./types.js";

export interface ReferenceData {
  currencies: readonly { code: string; name: string; minorUnits: number; active: boolean }[];
}

export async function loadReferenceData(
  migrator: DbHandle,
  data: ReferenceData,
): Promise<{ upserted: number }> {
  const existing = await migrator.executeSql("SELECT code, minor_units FROM currencies");
  const units = new Map(
    existing.rows.map((row) => [
      String(row["code"]),
      Number.parseInt(String(row["minor_units"]), 10),
    ]),
  );
  // Checked before any write, so a mismatch changes nothing.
  for (const currency of data.currencies) {
    const current = units.get(currency.code);
    if (current !== undefined && current !== currency.minorUnits) {
      throw new SchemaStepError("minor_units_changed", currency.code);
    }
  }
  // One statement, so it's atomic. Rows already equal to the file aren't touched.
  const result = await migrator.executeSql(
    `INSERT INTO currencies (code, name, minor_units, is_active)
     SELECT * FROM unnest($1::text[], $2::text[], $3::smallint[], $4::boolean[])
     ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, is_active = EXCLUDED.is_active, updated_at = now()
       WHERE (currencies.name, currencies.is_active) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.is_active)`,
    [
      data.currencies.map((c) => c.code),
      data.currencies.map((c) => c.name),
      data.currencies.map((c) => c.minorUnits),
      data.currencies.map((c) => c.active),
    ],
  );
  return { upserted: result.rowCount };
}
