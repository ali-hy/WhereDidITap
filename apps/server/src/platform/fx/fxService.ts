// F-132: currency conversion on stored days, and the rates-added subscribers.
import { PlainDateWire } from "@budmon/contract";
import {
  Money,
  Temporal,
  convertWithRates,
  parseDecimal,
  sum,
  utcDateOf,
  type Clock,
  type CurrencyCode,
} from "@budmon/shared";
import { z } from "zod";
import type { Database, DbHandle } from "../db/types.js";
import { describeFailure } from "../observability/describeFailure.js";
import type { Logger } from "../observability/logger.js";
import type { PlatformMetrics } from "../observability/metrics.js";
import type { JobDefinition } from "../queue/jobs.js";
import type { JobQueue } from "../queue/jobQueue.js";
import { fxBackfillJob } from "./fxJobs.js";
import { currencies, latestDayOnOrBefore, ratesOn } from "./fxRepo.js";

type NoRate = { kind: "no_rate"; reason: "no_day" | "currency_missing" };

export type ConversionResult =
  { kind: "converted"; money: Money; rateDate: Temporal.PlainDate; provisional: boolean } | NoRate;

export type SumResult = { kind: "converted"; total: Money; provisional: boolean } | NoRate;

export class UnknownCurrencyError extends Error {
  constructor(readonly currency: string) {
    super(`unknown currency: ${currency}`);
    this.name = "UnknownCurrencyError";
  }
}

export const RatesAddedPayload = z.object({
  rateDate: PlainDateWire,
  affectedFrom: PlainDateWire,
  affectedTo: PlainDateWire.nullable(),
});
export type RatesAddedPayload = z.infer<typeof RatesAddedPayload>;

/** The fallback provider's first day (Q-1: no rate before it). */
export const FX_FALLBACK_FIRST_DATE = "2024-03-02";

export interface FxService {
  convert(
    m: Money,
    to: CurrencyCode,
    onDate: Temporal.PlainDate,
    h?: DbHandle,
  ): Promise<ConversionResult>;
  convertSum(
    items: readonly { money: Money; onDate: Temporal.PlainDate }[],
    to: CurrencyCode,
    h?: DbHandle,
  ): Promise<SumResult>;
  registerRatesAddedSubscriber(def: JobDefinition<RatesAddedPayload>): void;
  subscribers(): readonly JobDefinition<RatesAddedPayload>[];
}

type CurrencyInfo = Map<string, { minorUnits: number; active: boolean }>;

export function createFxService(deps: {
  database: Database;
  queue: JobQueue;
  clock: Clock;
  logger: Logger;
  metrics: PlatformMetrics;
}): FxService {
  let currencyInfo: Promise<CurrencyInfo> | undefined;
  const subscriberList: JobDefinition<RatesAddedPayload>[] = [];
  const firstDate = Temporal.PlainDate.from(FX_FALLBACK_FIRST_DATE);

  /** Currency metadata, read once per service (the reference data changes only on deploy). */
  const currencyMeta = (h: DbHandle): Promise<CurrencyInfo> => {
    currencyInfo ??= currencies(h).catch((error: unknown) => {
      currencyInfo = undefined;
      throw error;
    });
    return currencyInfo;
  };

  /** Outside the caller's transaction, so the job survives its rollback. Never throws. */
  const backfill = async (onDate: Temporal.PlainDate): Promise<void> => {
    const rateDate = onDate.toString();
    try {
      await deps.queue.enqueue(
        deps.database.handle,
        fxBackfillJob,
        { rateDate },
        { singletonKey: rateDate },
      );
    } catch (err) {
      // A-277: best effort; the result is already right and the next convert retries it.
      deps.logger.warn("fx_backfill_enqueue_failed", { rateDate, ...describeFailure(err) }, err);
    }
  };

  const convert: FxService["convert"] = async (m, to, onDate, h) => {
    const handle = h ?? deps.database.handle;
    const meta = await currencyMeta(handle);
    const from = meta.get(m.currency);
    const target = meta.get(to);
    if (from === undefined) throw new UnknownCurrencyError(m.currency);
    if (target === undefined) throw new UnknownCurrencyError(to);
    if (m.currency === to) {
      return { kind: "converted", money: m, rateDate: onDate, provisional: false };
    }
    const today = utcDateOf(deps.clock.now());
    const date = onDate.toString();
    const day = await latestDayOnOrBefore(handle, date);
    if (day === null) {
      if (
        Temporal.PlainDate.compare(onDate, today) < 0 &&
        Temporal.PlainDate.compare(onDate, firstDate) >= 0
      ) {
        await backfill(onDate);
      }
      return { kind: "no_rate", reason: "no_day" };
    }
    const codes = [m.currency, to].filter((code) => code !== "USD");
    const stored = await ratesOn(handle, day, codes);
    const rateOf = (code: string): string | undefined => (code === "USD" ? "1" : stored.get(code));
    const fromRate = rateOf(m.currency);
    const toRate = rateOf(to);
    if (fromRate === undefined || toRate === undefined) {
      return { kind: "no_rate", reason: "currency_missing" };
    }
    const money = convertWithRates(
      m,
      { unitsPerUsd: parseDecimal(fromRate), minorUnits: from.minorUnits },
      { currency: to, unitsPerUsd: parseDecimal(toRate), minorUnits: target.minorUnits },
    );
    const rateDate = Temporal.PlainDate.from(day);
    if (
      Temporal.PlainDate.compare(rateDate, onDate) < 0 &&
      Temporal.PlainDate.compare(onDate, today.subtract({ days: 1 })) < 0 &&
      Temporal.PlainDate.compare(onDate, firstDate) >= 0
    ) {
      await backfill(onDate);
    }
    return { kind: "converted", money, rateDate, provisional: day !== date };
  };

  return {
    convert,
    async convertSum(items, to, h) {
      const parts: Money[] = [];
      let provisional = false;
      let missing: NoRate | undefined;
      for (const item of items) {
        const r = await convert(item.money, to, item.onDate, h);
        if (r.kind === "no_rate") {
          missing ??= r;
          continue;
        }
        parts.push(r.money);
        provisional ||= r.provisional;
      }
      if (missing !== undefined) return { kind: "no_rate", reason: missing.reason };
      return { kind: "converted", total: sum(parts, to), provisional };
    },
    registerRatesAddedSubscriber(def) {
      if (def.role !== "general" || def.payload !== RatesAddedPayload) {
        throw new TypeError(
          `a rates-added subscriber must be a general job with RatesAddedPayload: ${def.name}`,
        );
      }
      subscriberList.push(def);
    },
    subscribers: () => [...subscriberList],
  };
}
