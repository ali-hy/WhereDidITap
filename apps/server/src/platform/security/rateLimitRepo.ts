// F-64: the rate-limit counters (`rate_limit_counters`, UNLOGGED).
import type { DbHandle } from "../db/types.js";

/** Adds one hit to the bucket's window and returns the window's hits. */
export async function incrementWindow(
  h: DbHandle,
  bucketKey: string,
  windowStart: Date,
  expiresAt: Date,
): Promise<number> {
  const { rows } = await h.executeSql(
    `INSERT INTO rate_limit_counters (bucket_key, window_start, hits, expires_at)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (bucket_key, window_start)
     DO UPDATE SET hits = rate_limit_counters.hits + 1
     RETURNING hits`,
    [bucketKey, windowStart, expiresAt],
  );
  return Number.parseInt(String(rows[0]?.["hits"]), 10);
}

/** Deletes up to `batchSize` expired rows and returns how many went. */
export async function deleteExpired(h: DbHandle, now: Date, batchSize: number): Promise<number> {
  const { rows } = await h.executeSql(
    `WITH gone AS (
       DELETE FROM rate_limit_counters
       WHERE ctid IN (
         SELECT ctid FROM rate_limit_counters WHERE expires_at < $1 LIMIT $2
       )
       RETURNING 1
     )
     SELECT count(*)::int AS n FROM gone`,
    [now, batchSize],
  );
  return Number.parseInt(String(rows[0]?.["n"]), 10);
}
