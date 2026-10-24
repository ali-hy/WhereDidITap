// F-13: transactions with serialisation retries, and the commit tracker.
import { createHandle } from "./client.js";
import type { CommitTracker, Database, DbHandle } from "./types.js";

export function createCommitTracker(): CommitTracker {
  let committed = false;
  return {
    get committed() {
      return committed;
    },
    markCommitted() {
      committed = true;
    },
  };
}

const MAX_RETRIES = 3;

function isRetryable(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "40001" || code === "40P01";
}

export async function withTransaction<T>(
  database: Database,
  fn: (tx: DbHandle) => Promise<T>,
  opts: {
    isolation?: "read committed" | "serializable";
    tracker?: CommitTracker;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const isolation = opts.isolation === "serializable" ? "SERIALIZABLE" : "READ COMMITTED";

  for (let attempt = 0; ; attempt += 1) {
    const client = await database.pool.connect();
    let broken = false;
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const result = await fn(createHandle(client, true));
      await client.query("COMMIT");
      opts.tracker?.markCommitted();
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      if (!isRetryable(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
    } finally {
      client.release(broken);
    }
    await sleep(10 + Math.floor(random() * 40));
  }
}
