// F-137 FX jobs, F-138 enqueueRatesAdded and F-139 the gap check.
import { PlainDateWire } from "@budmon/contract";
import { Temporal, utcDateOf, type Clock } from "@budmon/shared";
import { z } from "zod";
import { withTransaction } from "../db/transaction.js";
import type { Database, DbHandle } from "../db/types.js";
import type { Logger } from "../observability/logger.js";
import type { PlatformMetrics } from "../observability/metrics.js";
import { defineJob } from "../queue/jobs.js";
import type { JobQueue } from "../queue/jobQueue.js";
import type { JobContext } from "../queue/wrapper.js";
import { normaliseRate } from "./decimal.js";
import { FX_FALLBACK_FIRST_DATE, type FxService } from "./fxService.js";
import {
  currencies,
  dayExists,
  insertDay,
  latestDayOnOrBefore,
  nextStoredDayAfter,
} from "./fxRepo.js";
import { FxProviderError, type FxProvider, type FxProviders } from "./providers.js";

const empty = z.object({});

export const fxRatesFetchJob = defineJob({
  name: "platform.fx-rates-fetch",
  role: "general",
  payload: empty,
  cron: "30 0 * * *",
  retryLimit: 14,
  retryDelaySeconds: 1800,
  retryBackoff: false,
  expireInSeconds: 300,
  policy: "singleton",
});

export const fxBackfillJob = defineJob({
  name: "platform.fx-backfill",
  role: "general",
  payload: z.object({ rateDate: PlainDateWire }),
  retryLimit: 5,
  retryBackoff: true,
  expireInSeconds: 300,
  policy: "short",
  // F-96: fx is built for worker-capture too, and its conversions may enqueue backfills.
  sendableFromCapture: true,
  // A-283: capture's rows must be keyed by their date (one queued backfill per date).
  captureSingletonKeyField: "rateDate",
});

export const fxGapCheckJob = defineJob({
  name: "platform.fx-gap-check",
  role: "general",
  payload: empty,
  cron: "45 6 * * *",
  // A-273: one queued and one active check at most (singleton only limits active jobs).
  policy: "stately",
  retryLimit: 3,
});

export const fxJobDefinitions = [fxRatesFetchJob, fxBackfillJob, fxGapCheckJob] as const;

/** F-138: one job per subscriber, in the inserting transaction. Returns how many. */
export async function enqueueRatesAdded(
  h: DbHandle,
  fx: FxService,
  queue: JobQueue,
  rateDate: string,
): Promise<number> {
  const next = await nextStoredDayAfter(h, rateDate);
  const affectedTo =
    next === null ? null : Temporal.PlainDate.from(next).subtract({ days: 1 }).toString();
  let count = 0;
  for (const def of fx.subscribers()) {
    await queue.enqueue(h, def, { rateDate, affectedFrom: rateDate, affectedTo });
    count += 1;
  }
  return count;
}

export interface FxJobDeps {
  database: Database;
  queue: JobQueue;
  clock: Clock;
  metrics: PlatformMetrics;
  fx: FxService;
  providers: FxProviders;
}

/** Fetches, filters and stores one day from `provider`, then fans out (F-137 steps 3 to 6). */
async function storeDayFrom(
  deps: FxJobDeps,
  provider: FxProvider,
  rateDate: string,
  ctx: Pick<JobContext, "logger" | "signal">,
): Promise<void> {
  const raw = await provider.fetchDay(rateDate, ctx.signal);
  const known = await currencies(deps.database.handle);
  const rows: { code: string; unitsPerUsd: string }[] = [];
  let rejected = 0;
  for (const [code, text] of raw) {
    // Codes that aren't active currencies are skipped; only a bad value counts as rejected.
    if (known.get(code)?.active !== true) continue;
    const unitsPerUsd = normaliseRate(text);
    if (unitsPerUsd === null) {
      rejected += 1;
      continue;
    }
    rows.push({ code, unitsPerUsd });
  }
  if (rejected > 0) deps.metrics.fxRatesRejected.add(rejected, { provider: provider.name });
  if (rows.length === 0) throw new FxProviderError("invalid");
  const fetchedAt = new Date(deps.clock.now().epochMilliseconds);
  const inserted = await withTransaction(deps.database, async (tx) => {
    const count = await insertDay(tx, rows, rateDate, provider.name, fetchedAt);
    // A-282: a racing fetch or backfill that inserted nothing doesn't notify again.
    if (count > 0) await enqueueRatesAdded(tx, deps.fx, deps.queue, rateDate);
    return count;
  });
  // A-300: counted and logged as stored only when this run inserted the day.
  if (inserted > 0) {
    deps.metrics.fxRatesFetched.add(1, { provider: provider.name });
    ctx.logger.info("fx_day_stored", { rateDate, provider: provider.name, inserted, rejected });
  } else {
    ctx.logger.info("fx_day_already_stored", { rateDate, provider: provider.name });
  }
}

const PRIMARY_WINDOW_MS = 6 * 3_600_000;

/** F-137, `platform.fx-rates-fetch`. */
export async function runFxRatesFetch(deps: FxJobDeps, ctx: JobContext): Promise<void> {
  // From the job's creation, so a retry keeps the same day.
  const rateDate = utcDateOf(ctx.createdOn).subtract({ days: 1 }).toString();
  if (await dayExists(deps.database.handle, rateDate)) return;
  const elapsed = deps.clock.now().epochMilliseconds - ctx.createdOn.epochMilliseconds;
  const provider = elapsed < PRIMARY_WINDOW_MS ? deps.providers.primary : deps.providers.fallback;
  await storeDayFrom(deps, provider, rateDate, ctx);
}

/** F-137, `platform.fx-backfill`. */
export async function runFxBackfill(
  deps: FxJobDeps,
  payload: { rateDate: string },
  ctx: JobContext,
): Promise<void> {
  const { rateDate } = payload;
  // A-275: worker-capture may send this job, so a date the fallback can't have is refused here.
  const today = utcDateOf(deps.clock.now()).toString();
  if (rateDate < FX_FALLBACK_FIRST_DATE || rateDate >= today) {
    ctx.logger.warn("fx_backfill_out_of_range", { rateDate });
    return;
  }
  if (await dayExists(deps.database.handle, rateDate)) return;
  try {
    await storeDayFrom(deps, deps.providers.fallback, rateDate, ctx);
  } catch (error) {
    if (error instanceof FxProviderError && error.reason === "not_found") {
      deps.metrics.fxBackfillMissing.add(1, {});
      ctx.logger.info("fx_backfill_missing", { rateDate });
      return;
    }
    throw error;
  }
}

const GAP_LIMIT = 31;

/** F-139: backfills for the days after the latest stored one, up to yesterday (UTC). */
export async function fxGapCheck(deps: {
  database: Database;
  queue: JobQueue;
  clock: Clock;
  logger: Logger;
}): Promise<{ enqueued: string[] }> {
  const yesterday = utcDateOf(deps.clock.now()).subtract({ days: 1 });
  const latest = await latestDayOnOrBefore(deps.database.handle, yesterday.toString());
  const enqueued: string[] = [];
  if (latest !== null) {
    let first = Temporal.PlainDate.from(latest).add({ days: 1 });
    const earliest = yesterday.subtract({ days: GAP_LIMIT - 1 });
    if (Temporal.PlainDate.compare(first, earliest) < 0) first = earliest;
    for (let d = first; Temporal.PlainDate.compare(d, yesterday) <= 0; d = d.add({ days: 1 })) {
      const rateDate = d.toString();
      await deps.queue.enqueue(
        deps.database.handle,
        fxBackfillJob,
        { rateDate },
        { singletonKey: rateDate },
      );
      enqueued.push(rateDate);
    }
  }
  deps.logger.info("fx_gap_check", { count: enqueued.length });
  return { enqueued };
}

/** The FX handlers for F-91's map. Fetch and backfill need the general role's providers. */
export function fxHandlers(c: {
  database: Database;
  queue: JobQueue;
  clock: Clock;
  metrics: PlatformMetrics;
  fx: FxService;
  fxProviders: FxProviders | null;
}): ReadonlyMap<string, (payload: unknown, ctx: JobContext) => Promise<unknown>> {
  const deps = (): FxJobDeps => {
    if (c.fxProviders === null) throw new Error("fx providers need the general role");
    return { ...c, providers: c.fxProviders };
  };
  return new Map<string, (payload: unknown, ctx: JobContext) => Promise<unknown>>([
    [
      fxRatesFetchJob.name,
      async (_payload, ctx) => {
        await runFxRatesFetch(deps(), ctx);
      },
    ],
    [
      fxBackfillJob.name,
      async (payload, ctx) => {
        await runFxBackfill(deps(), fxBackfillJob.payload.parse(payload), ctx);
      },
    ],
    [
      fxGapCheckJob.name,
      async (_payload, ctx) => {
        await fxGapCheck({
          database: c.database,
          queue: c.queue,
          clock: c.clock,
          logger: ctx.logger,
        });
      },
    ],
  ]);
}
