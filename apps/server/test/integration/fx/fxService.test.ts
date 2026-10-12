// F-131 fxRepo and F-132 createFxService on template copies. TP-9.2 to TP-9.8, TP-9.5b and
// TP-9.16, plus extra cases TP-9.24x. IDs ending in "x" are test-architect additions, not LLD
// test-plan IDs.
//
// Rates are stored as budmon_migrator (support/s9.ts storeDay), independent of F-131; the service
// is built on a general worker container's database and queue with a fixed clock.
import { Money, Temporal, asCurrencyCode, fixedClock } from "@budmon/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkerContainer } from "../../../src/platform/container.js";
import { withTransaction } from "../../../src/platform/db/transaction.js";
import { observed } from "../../support/api.js";
import { recordingLogger } from "../../support/platform.js";
import { TEST_FX_RATES_ADDED, TEST_JOBS, registryOf } from "../../support/jobs.js";
import { buildWorkerContainer, testWorkerConfig, type BuiltWorker } from "../../support/worker.js";
import { insertDay } from "../../../src/platform/fx/fxRepo.js";
import {
  type ConversionResult,
  createFxService,
  FX_FALLBACK_FIRST_DATE,
  type FxService,
  RatesAddedPayload,
  UnknownCurrencyError,
} from "../../../src/platform/fx/fxService.js";
import * as repo from "../../../src/platform/fx/fxRepo.js";
import { queuedJobs, storeDay, storedRates } from "../../support/s9.js";

const USD = asCurrencyCode("USD");
const EGP = asCurrencyCode("EGP");
const JPY = asCurrencyCode("JPY");
const KWD = asCurrencyCode("KWD");
const BACKFILL = "platform.fx-backfill";

const day = (d: string) => Temporal.PlainDate.from(d);

function serviceOn(built: BuiltWorker, now: string): FxService {
  const c = built.container;
  return createFxService({
    database: c.database,
    queue: c.queue,
    clock: fixedClock(now),
    logger: c.logger,
    metrics: c.metrics,
  });
}

function converted(r: ConversionResult) {
  if (r.kind !== "converted") throw new Error(`expected converted, got no_rate/${r.reason}`);
  return r;
}

describe("TP-9.2 to TP-9.4, TP-9.6 to TP-9.8: conversion on one stored day (F-132)", () => {
  let built: BuiltWorker;
  let fx: FxService;

  beforeAll(async () => {
    built = await buildWorkerContainer("general");
    // Enqueueing needs the container's pg-boss started (as F-90 does for the api).
    await built.container.boss.start();
    // Day 2026-10-04: EGP 48.5, JPY 149.25 (no KWD, TP-9.6).
    await storeDay(built.testDb, "2026-10-04", { EGP: "48.5", JPY: "149.25" });
    fx = serviceOn(built, "2026-10-05T12:00:00Z");
  }, 60_000);

  afterAll(async () => {
    await built.close();
  });

  it("TP-9.2: same currency gives the same money, provisional false, rateDate the given date", async () => {
    const m = Money.of(10000n, EGP);

    const r = converted(await fx.convert(m, EGP, day("2026-09-01")));

    expect(r.money.minor).toBe(10000n);
    expect(r.money.currency).toBe(EGP);
    expect(r.provisional).toBe(false);
    expect(r.rateDate.toString()).toBe("2026-09-01");
  });

  it("TP-9.3: EGP 123.45 to JPY on 2026-10-04 is JPY 380, provisional false", async () => {
    const r = converted(await fx.convert(Money.of(12345n, EGP), JPY, day("2026-10-04")));

    expect(r.money.minor).toBe(380n);
    expect(r.money.currency).toBe(JPY);
    expect(r.provisional).toBe(false);
    expect(r.rateDate.toString()).toBe("2026-10-04");
  });

  it("TP-9.4: on 2026-10-05 (not stored) the rate of 2026-10-04 is used, provisional true", async () => {
    const r = converted(await fx.convert(Money.of(12345n, EGP), JPY, day("2026-10-05")));

    expect(r.rateDate.toString()).toBe("2026-10-04");
    expect(r.provisional).toBe(true);
    expect(r.money.minor).toBe(380n);
  });

  it("TP-9.24x: USD is 1 implicitly: USD 1.00 to EGP is EGP 48.50; EGP 48.50 to USD is USD 1.00", async () => {
    const toEgp = converted(await fx.convert(Money.of(100n, USD), EGP, day("2026-10-04")));
    const toUsd = converted(await fx.convert(Money.of(4850n, EGP), USD, day("2026-10-04")));

    expect(toEgp.money.minor).toBe(4850n);
    expect(toUsd.money.minor).toBe(100n);
  });

  it("TP-9.6: USD to KWD on a day stored without KWD is no_rate/currency_missing, and no job", async () => {
    const r = await fx.convert(Money.of(100n, USD), KWD, day("2026-10-04"));

    expect(r).toEqual({ kind: "no_rate", reason: "currency_missing" });
    expect(await queuedJobs(built.testDb, BACKFILL)).toEqual([]);
  });

  it("TP-9.7: converting to ZZZ (a valid code, not in the table) throws UnknownCurrencyError", async () => {
    await expect(
      fx.convert(Money.of(100n, USD), asCurrencyCode("ZZZ"), day("2026-10-04")),
    ).rejects.toBeInstanceOf(UnknownCurrencyError);
  });

  it("TP-9.24x: converting from ZZZ throws UnknownCurrencyError too", async () => {
    await expect(
      fx.convert(Money.of(100n, asCurrencyCode("ZZZ")), USD, day("2026-10-04")),
    ).rejects.toBeInstanceOf(UnknownCurrencyError);
  });

  it("TP-9.8: 3 × EGP 0.30 to USD is USD 0.03 (each item rounds to 1 cent; sum-then-round would give 0.02)", async () => {
    const item = { money: Money.of(30n, EGP), onDate: day("2026-10-04") };

    const r = await fx.convertSum([item, item, item], USD);

    expect(r.kind).toBe("converted");
    if (r.kind !== "converted") return;
    expect(r.total.minor).toBe(3n);
    expect(r.total.currency).toBe(USD);
    expect(r.provisional).toBe(false);
  });

  it("TP-9.8: items on a stored day and an unstored later day give provisional true", async () => {
    const r = await fx.convertSum(
      [
        { money: Money.of(30n, EGP), onDate: day("2026-10-04") },
        { money: Money.of(30n, EGP), onDate: day("2026-10-05") },
      ],
      USD,
    );

    expect(r.kind).toBe("converted");
    if (r.kind !== "converted") return;
    expect(r.total.minor).toBe(2n);
    expect(r.provisional).toBe(true);
  });

  it("TP-9.8: an empty list is USD 0.00, provisional false", async () => {
    const r = await fx.convertSum([], USD);

    expect(r.kind).toBe("converted");
    if (r.kind !== "converted") return;
    expect(r.total.minor).toBe(0n);
    expect(r.total.currency).toBe(USD);
    expect(r.provisional).toBe(false);
  });

  it("TP-9.24x: convertSum with one item missing a rate is no_rate with that item's reason", async () => {
    const r = await fx.convertSum(
      [
        { money: Money.of(30n, EGP), onDate: day("2026-10-04") },
        { money: Money.of(100n, KWD), onDate: day("2026-10-04") },
      ],
      USD,
    );

    expect(r).toEqual({ kind: "no_rate", reason: "currency_missing" });
  });
});

describe("TP-9.5: no stored day (F-132)", () => {
  let built: BuiltWorker;

  beforeAll(async () => {
    built = await buildWorkerContainer("general");
    // Enqueueing needs the container's pg-boss started (as F-90 does for the api).
    await built.container.boss.start();
  }, 60_000);

  afterAll(async () => {
    await built.close();
  });

  it("TP-9.5: on an empty table, a future date is no_rate/no_day and enqueues nothing", async () => {
    const fx = serviceOn(built, "2026-10-05T12:00:00Z");

    const r = await fx.convert(Money.of(100n, USD), EGP, day("2026-10-10"));

    expect(r).toEqual({ kind: "no_rate", reason: "no_day" });
    expect(await queuedJobs(built.testDb, BACKFILL)).toEqual([]);
  });

  it("TP-9.5: first stored day 2026-10-01: 2025-01-10 inside a rolled-back transaction is no_rate/no_day and its backfill job survives the rollback; 2024-01-01 (before the floor) enqueues nothing", async () => {
    expect(FX_FALLBACK_FIRST_DATE).toBe("2024-03-02");
    await storeDay(built.testDb, "2026-10-01", { EGP: "48.5" });
    const fx = serviceOn(built, "2026-10-05T12:00:00Z");
    let inside: ConversionResult | undefined;

    await withTransaction(built.container.database, async (tx) => {
      inside = await fx.convert(Money.of(100n, USD), EGP, day("2025-01-10"), tx);
      throw new Error("roll back");
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== "roll back") throw error;
    });
    const before = await fx.convert(Money.of(100n, USD), EGP, day("2024-01-01"));

    expect(inside).toEqual({ kind: "no_rate", reason: "no_day" });
    expect(before).toEqual({ kind: "no_rate", reason: "no_day" });
    const jobs = await queuedJobs(built.testDb, BACKFILL);
    expect(jobs.map((j) => j.data)).toEqual([{ rateDate: "2025-01-10" }]);
    expect(jobs[0]?.singletonKey).toBe("2025-01-10");
  });

  it("TP-9.5 (A-277): with a queue whose enqueue rejects, convert(…, 2025-01-10) is still no_rate/no_day, doesn't throw, and logs one fx_backfill_enqueue_failed warn with rateDate", async () => {
    const logger = recordingLogger();
    const fx = createFxService({
      database: built.container.database,
      queue: { enqueue: () => Promise.reject(new Error("queue down")) },
      clock: fixedClock("2026-10-05T12:00:00Z"),
      logger,
      metrics: built.container.metrics,
    });

    const r = await fx.convert(Money.of(100n, USD), EGP, day("2025-01-10"));

    expect(r).toEqual({ kind: "no_rate", reason: "no_day" });
    const warned = logger.lines.filter((l) => l.event === "fx_backfill_enqueue_failed");
    expect(warned).toHaveLength(1);
    expect(warned[0]?.level).toBe("warn");
    expect(warned[0]?.fields).toMatchObject({ fields: { rateDate: "2025-01-10" } });
  });

  it("TP-9.24x: converting 2025-01-10 again doesn't add a second backfill job (singletonKey)", async () => {
    const fx = serviceOn(built, "2026-10-05T12:00:00Z");

    await fx.convert(Money.of(100n, USD), EGP, day("2025-01-10"));

    expect((await queuedJobs(built.testDb, BACKFILL)).map((j) => j.data)).toEqual([
      { rateDate: "2025-01-10" },
    ]);
  });
});

describe("TP-9.5b: a provisional past date enqueues a backfill (F-132, S-1)", () => {
  let built: BuiltWorker;

  beforeAll(async () => {
    built = await buildWorkerContainer("general");
    // Enqueueing needs the container's pg-boss started (as F-90 does for the api).
    await built.container.boss.start();
    await storeDay(built.testDb, "2026-09-28", { EGP: "48.4" });
    await storeDay(built.testDb, "2026-10-01", { EGP: "48.5" });
  }, 60_000);

  afterAll(async () => {
    await built.close();
  });

  it("TP-9.5b: 2026-09-30 and 2026-10-04 are both provisional; a backfill for 2026-09-30 only (2026-10-04 is today − 1, the daily job is due)", async () => {
    const fx = serviceOn(built, "2026-10-05T12:00:00Z");

    const older = converted(await fx.convert(Money.of(100n, USD), EGP, day("2026-09-30")));
    const recent = converted(await fx.convert(Money.of(100n, USD), EGP, day("2026-10-04")));

    expect(older.provisional).toBe(true);
    expect(older.rateDate.toString()).toBe("2026-09-28");
    expect(recent.provisional).toBe(true);
    expect(recent.rateDate.toString()).toBe("2026-10-01");
    const jobs = await queuedJobs(built.testDb, BACKFILL);
    expect(jobs.map((j) => j.data)).toEqual([{ rateDate: "2026-09-30" }]);
    expect(jobs[0]?.singletonKey).toBe("2026-09-30");
  });
});

describe("TP-9.16: stored days are final (F-131)", () => {
  let built: BuiltWorker;

  beforeAll(async () => {
    built = await buildWorkerContainer("general");
    // Enqueueing needs the container's pg-boss started (as F-90 does for the api).
    await built.container.boss.start();
  }, 60_000);

  afterAll(async () => {
    await built.close();
  });

  it("TP-9.16: insertDay again for a stored day with different values returns 0 and leaves the values unchanged", async () => {
    const h = built.container.database.handle;

    const first = await insertDay(
      h,
      [
        { code: "EGP", unitsPerUsd: "48.5" },
        { code: "JPY", unitsPerUsd: "149.25" },
      ],
      "2026-10-04",
      "openexchangerates",
      new Date("2026-10-05T00:30:00Z"),
    );
    const second = await insertDay(
      h,
      [
        { code: "EGP", unitsPerUsd: "50" },
        { code: "JPY", unitsPerUsd: "150" },
      ],
      "2026-10-04",
      "fawazahmed0",
      new Date("2026-10-05T06:30:00Z"),
    );

    expect(first).toBe(2);
    expect(second).toBe(0);
    expect(await storedRates(built.testDb)).toEqual([
      {
        code: "EGP",
        rateDate: "2026-10-04",
        unitsPerUsd: "48.500000000000",
        provider: "openexchangerates",
      },
      {
        code: "JPY",
        rateDate: "2026-10-04",
        unitsPerUsd: "149.250000000000",
        provider: "openexchangerates",
      },
    ]);
  });

  it("TP-9.24x: the other repo reads: latest day on or before, next day after, day exists, rates on a day, currencies", async () => {
    const h = built.container.database.handle;
    await storeDay(built.testDb, "2026-10-07", { EGP: "48.7" });

    expect(await repo.latestDayOnOrBefore(h, "2026-10-06")).toBe("2026-10-04");
    expect(await repo.latestDayOnOrBefore(h, "2026-10-07")).toBe("2026-10-07");
    expect(await repo.latestDayOnOrBefore(h, "2026-10-03")).toBeNull();
    expect(await repo.nextStoredDayAfter(h, "2026-10-04")).toBe("2026-10-07");
    expect(await repo.nextStoredDayAfter(h, "2026-10-07")).toBeNull();
    expect(await repo.dayExists(h, "2026-10-04")).toBe(true);
    expect(await repo.dayExists(h, "2026-10-05")).toBe(false);
    expect(await repo.ratesOn(h, "2026-10-04", ["EGP", "KWD"])).toEqual(
      new Map([["EGP", "48.500000000000"]]),
    );
    const currencies = await repo.currencies(h);
    expect(currencies.get("JPY")).toEqual({ minorUnits: 0, active: true });
    expect(currencies.get("ZWL")).toEqual({ minorUnits: 2, active: false });
    expect(currencies.has("XAU")).toBe(false);
  });
});

describe("TP-9.15 (c): subscribers must be in the job registry (F-96, A-266)", () => {
  let built: BuiltWorker;

  beforeAll(async () => {
    built = await buildWorkerContainer("general");
    // Enqueueing needs the container's pg-boss started (as F-90 does for the api).
    await built.container.boss.start();
  }, 60_000);

  afterAll(async () => {
    await built.close();
  });

  it("TP-9.15 (c): a general RatesAddedPayload subscriber missing from the registry makes createWorkerContainer throw TypeError naming it", async () => {
    const fx = serviceOn(built, "2026-10-05T12:00:00Z");
    fx.registerRatesAddedSubscriber({ ...TEST_FX_RATES_ADDED, payload: RatesAddedPayload });
    let made: { close(): Promise<void> } | undefined;

    const build = () => {
      made = createWorkerContainer(
        testWorkerConfig(built.testDb.endpoint, built.testDb.name, "general"),
        {
          ...observed().overrides,
          registry: registryOf([TEST_JOBS.ok]),
          fx,
        },
      );
    };

    try {
      expect(build).toThrow(new TypeError("fx subscriber not registered: test.fx-rates-added"));
    } finally {
      await made?.close();
    }
  });
});
