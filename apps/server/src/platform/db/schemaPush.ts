// F-17: builds the schema from the Drizzle definitions onto an empty database (development and
// test only; never imported by main/migrate.ts).
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../../db/schema/index.js";
import type { DbHandle } from "./types.js";

export class PushTargetNotEmptyError extends Error {
  constructor(tables: readonly string[]) {
    super(
      `push needs an empty database; public already has: ${tables.slice(0, 5).join(", ")}${tables.length > 5 ? ", …" : ""}`,
    );
    this.name = "PushTargetNotEmptyError";
  }
}

export async function pushSchemaOntoEmpty(migrator: DbHandle): Promise<{ statements: number }> {
  const { rows } = await migrator.executeSql(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  if (rows.length > 0) {
    throw new PushTargetNotEmptyError(rows.map((row) => String(row["tablename"])));
  }
  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema, undefined, undefined, "snake_case"),
  );
  statements.push('ALTER TABLE "rate_limit_counters" SET UNLOGGED');
  // One simple-protocol query with several statements is a single implicit transaction.
  await migrator.executeSql(statements.join(";\n"));
  return { statements: statements.length };
}
