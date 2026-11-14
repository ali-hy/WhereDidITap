// F-78 and F-139 start-up enqueue, the F-42 freshness gauge and the F-23 FX seeder, on template
// copies. TP-9.17, TP-9.18 and TP-9.20, plus extra cases TP-9.24x. IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
//
// TP-9.17 (A-265): the general worker observes the gauge, refreshed with the queue depths.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fixedClock } from "@budmon/shared";
import { afterAll, describe, expect, it } from "vitest";
import { createWorkerContainer } from "../../../src/platform/container.js";
import { runSeeders, seeders } from "../../../src/platform/db/seed.js";
import { fxGapCheckJob } from "../../../src/platform/fx/fxJobs.js";
import { buildHandlerMap } from "../../../src/platform/queue/handlers.js";
import { startWorkers } from "../../../src/platform/queue/workers.js";
import { observed } from "../../support/api.js";
import { waitFor, type JobHandler, type WorkerContainer } from "../../support/jobs.js";
import { query } from "../../support/postgres.js";
import { buildWorkerContainer, testWorkerConfig } from "../../support/worker.js";
import { queuedJobs, storeDay, storedRates } from "../../support/s9.js";

const GAP_CHECK = "platform.fx-gap-check";

const heartbeatDir = mkdtempSync(path.join(tmpdir(), "budmon-fx-heartbeat-"));
let heartbeats = 0;
function heartbeatPath(): string {
  heartbeats += 1;
  return path.join(heartbeatDir, `heartbeat-${String(heartbeats)}`);
}

afterAll(() => {
  rmSync(heartbeatDir, { recursive: true, force: true });
});

/** The production handlers, with the gap check held until `release` (so its job stays). */
function heldHandlers(c: WorkerContainer): {
  handlers: Map<string, JobHandler>;
  release: () => void;
} {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handlers = new Map(buildHandlerMap(c));
  handlers.set(GAP_CHECK, async () => {
    await held;
  });
  return { handlers, release };
}

describe("TP-9.20: the start-up gap check (F-78, F-139)", () => {
  it("TP-9.20 (a): one general worker enqueues one platform.fx-gap-check with singletonKey startup and schedules it at 45 6 * * * UTC", async () => {
    const built = await buildWorkerContainer("general");
    const { handlers, release } = heldHandlers(built.container);
    try {
      const w = await startWorkers(built.container, handlers, { heartbeatPath: heartbeatPath() });
      try {
        const jobs = await queuedJobs(built.testDb, GAP_CHECK);
        const schedules = await query<{ name: string; cron: string; timezone: string }>(
          built.testDb.urlAs("budmon_queue"),
          "SELECT name, cron, timezone FROM pgboss.schedule WHERE name LIKE 'platform.fx-%' ORDER BY name",
        );

        expect(jobs).toHaveLength(1);
        expect(jobs[0]?.singletonKey).toBe("startup");
        expect(jobs[0]?.data).toEqual({});
        expect(schedules).toContainEqual({ name: GAP_CHECK, cron: "45 6 * * *", timezone: "UTC" });
        // TP-9.24x: the daily fetch is scheduled too (F-137).
        expect(schedules).toContainEqual({
          name: "platform.fx-rates-fetch",
          cron: "30 0 * * *",
          timezone: "UTC",
        });
      } finally {
        release();
        await w.stop();
      }
    } finally {
      await built.close();
    }
  }, 120_000);

  it("TP-9.20 (b1): with no worker, two enqueues with singletonKey startup: the second returns null and there's one row", async () => {
    const built = await buildWorkerContainer("general");
    try {
      await built.container.boss.start();
      const c = built.container;
      const enqueue = () =>
        c.queue.enqueue(c.database.handle, fxGapCheckJob, {}, { singletonKey: "startup" });

      const first = await enqueue();
      const second = await enqueue();

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(await queuedJobs(built.testDb, GAP_CHECK)).toHaveLength(1);
    } finally {
      await built.close();
    }
  }, 120_000);

  it("TP-9.20 (b2): two general workers started together leave at most one created and at most one active startup job (A-273)", async () => {
    const built = await buildWorkerContainer("general");
    const second = createWorkerContainer(
      testWorkerConfig(built.testDb.endpoint, built.testDb.name, "general"),
      observed().overrides,
    );
    const one = heldHandlers(built.container);
    const two = heldHandlers(second);
    try {
      const workers = await Promise.all([
        startWorkers(built.container, one.handlers, { heartbeatPath: heartbeatPath() }),
        startWorkers(second, two.handlers, { heartbeatPath: heartbeatPath() }),
      ]);
      try {
        const jobs = (await queuedJobs(built.testDb, GAP_CHECK)).filter(
          (j) => j.singletonKey === "startup",
        );
        const states = JSON.stringify(jobs);
        expect(jobs.length, states).toBeGreaterThanOrEqual(1);
        expect(jobs.filter((j) => j.state === "created").length, states).toBeLessThanOrEqual(1);
        expect(jobs.filter((j) => j.state === "active").length, states).toBeLessThanOrEqual(1);
      } finally {
        one.release();
        two.release();
        await Promise.all(workers.map((w) => w.stop()));
      }
    } finally {
      await second.close();
      await built.close();
    }
  }, 120_000);

  it("TP-9.20 (c): a capture-role worker enqueues no gap check", async () => {
    const built = await buildWorkerContainer("capture");
    try {
      const w = await startWorkers(built.container, buildHandlerMap(built.container), {
        heartbeatPath: heartbeatPath(),
      });
      try {
        expect(await queuedJobs(built.testDb, GAP_CHECK)).toEqual([]);
      } finally {
        await w.stop();
      }
    } finally {
      await built.close();
    }
  }, 120_000);
});

describe("TP-9.17: the freshness gauge (F-42)", () => {
  it("TP-9.17: with the latest day 2026-10-04, fx_last_day_timestamp_seconds is epoch(2026-10-05T00:00Z)", async () => {
    const built = await buildWorkerContainer("general");
    const { handlers, release } = heldHandlers(built.container);
    try {
      await storeDay(built.testDb, "2026-10-01", { EGP: "48.4" });
      await storeDay(built.testDb, "2026-10-04", { EGP: "48.5" });
      const w = await startWorkers(built.container, handlers, { heartbeatPath: heartbeatPath() });
      try {
        const expected = Date.UTC(2026, 9, 5) / 1000;
        let seen: unknown;
        await waitFor(
          async () => {
            const metric = (await built.obs.collect()).get("fx_last_day_timestamp_seconds");
            seen = metric?.dataPoints.map((p) => p.value);
            return metric?.dataPoints.some((p) => p.value === expected) ?? false;
          },
          10_000,
          "fx_last_day_timestamp_seconds",
        ).catch(() => undefined);

        expect(seen).toEqual([expected]);
      } finally {
        release();
        await w.stop();
      }
    } finally {
      await built.close();
    }
  }, 120_000);
});

describe("TP-9.24x: the freshness gauge with no stored day (A-265)", () => {
  it("TP-9.24x: an empty exchange_rates gives no fx_last_day_timestamp_seconds data point", async () => {
    const built = await buildWorkerContainer("general");
    const { handlers, release } = heldHandlers(built.container);
    try {
      const w = await startWorkers(built.container, handlers, { heartbeatPath: heartbeatPath() });
      try {
        const metric = (await built.obs.collect()).get("fx_last_day_timestamp_seconds");

        expect(metric?.dataPoints ?? []).toEqual([]);
      } finally {
        release();
        await w.stop();
      }
    } finally {
      await built.close();
    }
  }, 120_000);
});

describe("TP-9.18: the development FX seeder (F-23)", () => {
  it("TP-9.18: runSeeders twice: 30 days × 7 currencies with provider fixed after the first run; the second inserts nothing and doesn't fail", async () => {
    const built = await buildWorkerContainer("general", {
      clock: fixedClock("2026-10-05T12:00:00Z"),
    });
    try {
      expect(seeders.map((s) => s.name)).toContain("platform.fx-rates");

      await runSeeders(built.container);
      const first = await storedRates(built.testDb);
      await runSeeders(built.container);
      const second = await storedRates(built.testDb);

      expect(first).toHaveLength(30 * 7);
      expect(new Set(first.map((r) => r.provider))).toEqual(new Set(["fixed"]));
      expect(new Set(first.map((r) => r.code))).toEqual(
        new Set(["USD", "EUR", "GBP", "EGP", "JPY", "KWD", "SAR"]),
      );
      const days = [...new Set(first.map((r) => r.rateDate))].sort();
      expect(days).toHaveLength(30);
      // "The 30 days before today (UTC)": 2026-09-05 to 2026-10-04 for a clock on 2026-10-05.
      expect(days[0]).toBe("2026-09-05");
      expect(days.at(-1)).toBe("2026-10-04");
      expect(first.find((r) => r.code === "EGP")?.unitsPerUsd).toBe("48.500000000000");
      expect(second).toEqual(first);
    } finally {
      await built.close();
    }
  }, 120_000);
});
