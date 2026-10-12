// F-150: checks a restored database: the schema window, every B-tree index (amcheck) and exact
// row counts. Runs as budmon_migrator (pg_read_all_data and EXECUTE on bt_index_check, F-14).
import { withTransaction } from "../db/transaction.js";
import type { Database } from "../db/types.js";
import { schemaWindow } from "../http/health.js";

export interface RestoreReport {
  ok: boolean;
  schema: "ok" | "behind" | "ahead" | "not_migrated";
  amcheck: { indexesChecked: number; failures: { index: string; code: string }[] };
  tables: { schema: string; table: string; rows: number }[];
}

const SCHEMAS = "('public', 'pgboss')";

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** A bigint count as returned by pg (text), as a number; row counts stay far below 2^53. */
function countOf(value: unknown): number {
  return Number.parseInt(String(value), 10);
}

async function schemaState(
  database: Database,
  journal: readonly { hash: string; when: number }[],
): Promise<RestoreReport["schema"]> {
  const { rows: present } = await database.handle.executeSql(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
  );
  if (present[0]?.["present"] !== true) return "not_migrated";
  const { rows } = await database.handle.executeSql(
    "SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations",
  );
  return schemaWindow(
    rows.map((r) => ({ hash: String(r["hash"]), createdAt: countOf(r["created_at"]) })),
    journal,
  );
}

async function checkIndexes(database: Database): Promise<RestoreReport["amcheck"]> {
  // A-291: leaf B-tree indexes only (relkind 'i'); partitioned parents ('I') hold no data.
  // Failures still count as checked.
  const { rows } = await database.handle.executeSql(
    `SELECT c.oid::int8::text AS oid, ns.nspname AS schema, c.relname AS name
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_am am ON am.oid = c.relam
       JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE am.amname = 'btree' AND c.relkind = 'i' AND ns.nspname IN ${SCHEMAS}
      ORDER BY ns.nspname, c.relname`,
  );
  const failures: { index: string; code: string }[] = [];
  for (const row of rows) {
    const index = `${String(row["schema"])}.${String(row["name"])}`;
    try {
      await database.handle.executeSql(
        "SELECT bt_index_check(index => $1::oid::regclass, heapallindexed => true)",
        [String(row["oid"])],
      );
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      failures.push({ index, code: typeof code === "string" ? code : "unknown" });
    }
  }
  return { indexesChecked: rows.length, failures };
}

async function countTables(database: Database): Promise<RestoreReport["tables"]> {
  // Partitions are counted through their parent (pgboss.job includes job_common, A-229).
  const { rows } = await database.handle.executeSql(
    `SELECT n.nspname AS schema, c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname IN ${SCHEMAS}
      ORDER BY n.nspname, c.relname`,
  );
  const tables: RestoreReport["tables"] = [];
  for (const row of rows) {
    const schema = String(row["schema"]);
    const table = String(row["name"]);
    const sql = `SELECT count(*)::text AS n FROM ${quoteIdent(schema)}.${quoteIdent(table)}`;
    let result;
    if (schema === "pgboss" && table === "job") {
      // A-229: RLS hides job rows from budmon_migrator; their owner sees them all.
      result = await withTransaction(database, async (tx) => {
        await tx.executeSql("SET LOCAL ROLE budmon_queue");
        return tx.executeSql(sql);
      });
    } else {
      result = await database.handle.executeSql(sql);
    }
    tables.push({ schema, table, rows: countOf(result.rows[0]?.["n"]) });
  }
  return tables;
}

export async function verifyRestore(deps: {
  database: Database;
  journal: readonly { hash: string; when: number }[];
}): Promise<RestoreReport> {
  const schema = await schemaState(deps.database, deps.journal);
  const amcheck = await checkIndexes(deps.database);
  const tables = await countTables(deps.database);
  return { ok: schema === "ok" && amcheck.failures.length === 0, schema, amcheck, tables };
}
