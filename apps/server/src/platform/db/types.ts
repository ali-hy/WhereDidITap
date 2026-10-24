import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../../db/schema/index.js";

export type Schema = typeof schema;
export type Executor = NodePgDatabase<Schema>;
export interface SqlResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}
export interface DbHandle {
  /** drizzle bound to the pool or to the open transaction. */
  readonly db: Executor;
  executeSql(text: string, values?: readonly unknown[]): Promise<SqlResult>;
  readonly inTransaction: boolean;
}
export interface Database {
  readonly handle: DbHandle;
  readonly pool: import("pg").Pool;
  close(): Promise<void>;
}
export interface CommitTracker {
  readonly committed: boolean;
  markCommitted(): void;
}
