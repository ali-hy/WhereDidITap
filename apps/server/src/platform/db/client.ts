// F-12: the connection pool and its drizzle handle.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../db/schema/index.js";
import type { Config } from "../config/schema.js";
import type { Database, DbHandle, SqlResult } from "./types.js";

type Queryable = Pick<pg.Pool, "query">;

export function createHandle(client: pg.Pool | pg.PoolClient, inTransaction: boolean): DbHandle {
  const queryable: Queryable = client;
  return {
    db: drizzle({ client, schema, casing: "snake_case" }),
    executeSql: async (text, values): Promise<SqlResult> => {
      const result = await queryable.query(text, values === undefined ? undefined : [...values]);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
    },
    inTransaction,
  };
}

export function createDatabase(
  cfg: Config["db"],
  opts: { applicationName: string; onError?: (err: Error) => void },
): Database {
  const pool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.name,
    user: cfg.user,
    password: cfg.password.reveal(),
    max: cfg.poolMax,
    application_name: opts.applicationName,
    statement_timeout: 30000,
    idle_in_transaction_session_timeout: 60000,
    ssl:
      cfg.sslmode === "verify-full"
        ? { ca: cfg.sslRootCert, rejectUnauthorized: true, servername: cfg.host }
        : false,
  });
  pool.on("error", (err) => {
    opts.onError?.(err);
  });
  return {
    handle: createHandle(pool, false),
    pool,
    close: () => pool.end(),
  };
}
