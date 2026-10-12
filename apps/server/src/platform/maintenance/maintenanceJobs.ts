// F-80: the platform's maintenance jobs (general role, scheduled).
import type { Clock } from "@budmon/shared";
import { z } from "zod";
import type { WorkerContainer } from "../container.js";
import type { Database } from "../db/types.js";
import type { Logger } from "../observability/logger.js";
import { defineJob } from "../queue/jobs.js";
import type { JobHandler } from "../queue/workers.js";
import { deleteExpired } from "../security/rateLimitRepo.js";
import { purgeExpiredExports } from "../storage/exportsPurge.js";

const empty = z.object({});

export const idempotencyPurgeJob = defineJob({
  name: "platform.idempotency-purge",
  role: "general",
  payload: empty,
  cron: "0 3 * * *",
  // A-358: one retry after 5 minutes; the next scheduled run covers the rest.
  retryLimit: 1,
  retryDelaySeconds: 300,
  retryBackoff: false,
});

export const rateLimitPurgeJob = defineJob({
  name: "platform.rate-limit-purge",
  role: "general",
  payload: empty,
  cron: "*/10 * * * *",
  // A-358: one retry after 5 minutes; the next scheduled run covers the rest.
  retryLimit: 1,
  retryDelaySeconds: 300,
  retryBackoff: false,
});

/** A-215: registered with F-144's handler (S-10). */
export const exportsPurgeJob = defineJob({
  name: "platform.exports-purge",
  role: "general",
  payload: empty,
  cron: "15 * * * *",
  // A-358: one retry after 5 minutes; the next scheduled run covers the rest.
  retryLimit: 1,
  retryDelaySeconds: 300,
  retryBackoff: false,
});

export const platformMaintenanceJobs = [
  idempotencyPurgeJob,
  rateLimitPurgeJob,
  exportsPurgeJob,
] as const;

interface PurgeDeps {
  database: Database;
  clock: Clock;
  logger: Logger;
}

const IDEMPOTENCY_BATCH = 5000;
const RATE_LIMIT_BATCH = 10_000;

/** Deletes expired idempotency records in batches; logs the total once. */
export async function purgeIdempotencyRecords(deps: PurgeDeps): Promise<number> {
  const now = new Date(deps.clock.now().epochMilliseconds);
  let total = 0;
  for (;;) {
    const { rowCount } = await deps.database.handle.executeSql(
      `DELETE FROM idempotency_records WHERE ctid IN (
         SELECT ctid FROM idempotency_records WHERE expires_at < $1 LIMIT ${String(IDEMPOTENCY_BATCH)}
       )`,
      [now],
    );
    total += rowCount;
    if (rowCount < IDEMPOTENCY_BATCH) break;
  }
  deps.logger.info("idempotency_purged", { count: total });
  return total;
}

/** Deletes expired rate-limit counters in batches (F-64, A-193); logs the total once. */
export async function purgeRateLimitCounters(deps: PurgeDeps): Promise<number> {
  const now = new Date(deps.clock.now().epochMilliseconds);
  let total = 0;
  for (;;) {
    const deleted = await deleteExpired(deps.database.handle, now, RATE_LIMIT_BATCH);
    total += deleted;
    if (deleted < RATE_LIMIT_BATCH) break;
  }
  deps.logger.info("rate_limits_purged", { count: total });
  return total;
}

export function maintenanceHandlers(c: WorkerContainer): ReadonlyMap<string, JobHandler> {
  const deps = (logger: Logger): PurgeDeps => ({ database: c.database, clock: c.clock, logger });
  return new Map<string, JobHandler>([
    [
      idempotencyPurgeJob.name,
      async (_payload, ctx) => {
        await purgeIdempotencyRecords(deps(ctx.logger));
      },
    ],
    [
      rateLimitPurgeJob.name,
      async (_payload, ctx) => {
        await purgeRateLimitCounters(deps(ctx.logger));
      },
    ],
    [
      exportsPurgeJob.name,
      async (_payload, ctx) => {
        // General-only member; the job is general, so it's present wherever this runs.
        if (c.objectStore === null) throw new Error("exports purge needs the general role");
        await purgeExpiredExports({ store: c.objectStore, clock: c.clock, logger: ctx.logger });
      },
    ],
  ]);
}
