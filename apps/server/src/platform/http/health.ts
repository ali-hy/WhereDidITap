// F-57: liveness, readiness and the schema window.
import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../config/schema.js";
import type { Database } from "../db/types.js";

type Journal = readonly { hash: string; when: number }[];

export function schemaWindow(
  applied: readonly { hash: string; createdAt: number }[],
  journal: Journal,
): "ok" | "behind" | "ahead" {
  const appliedHashes = new Set(applied.map((a) => a.hash));
  if (journal.some((entry) => !appliedHashes.has(entry.hash))) return "behind";
  const journalHashes = new Set(journal.map((j) => j.hash));
  const extra = applied.filter((a) => !journalHashes.has(a.hash)).length;
  return extra > 1 ? "ahead" : "ok";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timed out"));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("query failed"));
      },
    );
  });
}

export async function checkReadiness(deps: {
  db: Database;
  appEnv: AppEnv;
  journal: Journal;
  timeoutMs?: number;
}): Promise<
  | { ready: true }
  | { ready: false; reason: "database_unreachable" | "schema_behind" | "schema_ahead" }
> {
  const timeoutMs = deps.timeoutMs ?? 2000;
  try {
    await withTimeout(deps.db.handle.executeSql("SELECT 1"), timeoutMs);
  } catch {
    return { ready: false, reason: "database_unreachable" };
  }
  if (deps.appEnv === "development" || deps.appEnv === "test") return { ready: true };
  try {
    const table = await withTimeout(
      deps.db.handle.executeSql(
        "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
      ),
      timeoutMs,
    );
    if (table.rows[0]?.["present"] !== true) {
      return deps.journal.length === 0
        ? { ready: true }
        : { ready: false, reason: "schema_behind" };
    }
    const { rows } = await withTimeout(
      deps.db.handle.executeSql("SELECT hash, created_at FROM drizzle.__drizzle_migrations"),
      timeoutMs,
    );
    const applied = rows.map((row) => ({
      hash: String(row["hash"]),
      createdAt: Number.parseInt(String(row["created_at"]), 10),
    }));
    const window = schemaWindow(applied, deps.journal);
    if (window === "ok") return { ready: true };
    return { ready: false, reason: window === "behind" ? "schema_behind" : "schema_ahead" };
  } catch {
    return { ready: false, reason: "database_unreachable" };
  }
}

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: { db: Database; appEnv: AppEnv; journal: Journal; timeoutMs?: number },
): void {
  app.get("/health/live", async (_request, reply) => {
    return reply.header("cache-control", "no-store").send({ status: "ok" });
  });
  app.get("/health/ready", async (_request, reply) => {
    const result = await checkReadiness(deps);
    reply.header("cache-control", "no-store");
    if (result.ready) return reply.send({ status: "ready" });
    return reply.code(503).send({ status: "not_ready", reason: result.reason });
  });
}
