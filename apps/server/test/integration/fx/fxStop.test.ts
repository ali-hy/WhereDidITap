// F-137's fetch under F-78's stop() within F-91's 35 s budget (A-302). TP-9.23.
//
// The worker runs through runWorker (F-91) with a handler override: platform.fx-rates-fetch runs
// F-137's runFxRatesFetch with a fake primary whose fetchDay resolves only when released (or
// rejects when its signal aborts). Its other dependencies come from a second container on the
// same database.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { systemClock, utcDateOf } from "@budmon/shared";
import { afterEach, describe, expect, it } from "vitest";
import { runWorker } from "../../../src/main/worker.js";
import { createWorkerContainer } from "../../../src/platform/container.js";
import { fxRatesFetchJob, runFxRatesFetch } from "../../../src/platform/fx/fxJobs.js";
import type { FxProvider } from "../../../src/platform/fx/providers.js";
import { observed } from "../../support/api.js";
import { waitFor, type JobHandler } from "../../support/jobs.js";
import { query } from "../../support/postgres.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { testWorkerConfig, testWorkerEnv } from "../../support/worker.js";
import { storedRates } from "../../support/s9.js";

const BUDGET_MS = 35_000;

let cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  cleanup = [];
});

/** A primary whose fetchDay waits for release() (or rejects when its signal aborts). */
function heldPrimary(): FxProvider & { started: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  return {
    name: "openexchangerates",
    started,
    release,
    fetchDay: (_date, signal) => {
      markStarted();
      return new Promise<Map<string, string>>((resolve, reject) => {
        void released.then(() => {
          resolve(new Map([["EGP", "48.5"]]));
        });
        signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    },
  };
}

async function start(testDb: TestDatabase, primary: FxProvider) {
  const dir = mkdtempSync(path.join(tmpdir(), "budmon-fx-stop-"));
  cleanup.push(() => {
    rmSync(dir, { recursive: true, force: true });
    return Promise.resolve();
  });
  const aux = createWorkerContainer(
    testWorkerConfig(testDb.endpoint, testDb.name, "general"),
    observed().overrides,
  );
  cleanup.push(() => aux.close());
  await aux.boss.start();
  const fetch: JobHandler = (_payload, ctx) =>
    runFxRatesFetch(
      {
        database: aux.database,
        queue: aux.queue,
        clock: systemClock,
        metrics: aux.metrics,
        fx: aux.fx,
        providers: { primary, fallback: primary },
      },
      ctx,
    );
  const env = {
    ...testWorkerEnv(dir, testDb.endpoint, testDb.name, "general"),
    HEARTBEAT_FILE: path.join(dir, "heartbeat"),
  };
  const worker = await runWorker(env, { handlers: new Map([[fxRatesFetchJob.name, fetch]]) });
  const id = (await aux.queue.enqueue(aux.database.handle, fxRatesFetchJob, {})) ?? "";
  return { worker, id };
}

async function stateOf(testDb: TestDatabase, id: string): Promise<string | undefined> {
  return (
    await query<{ state: string }>(
      testDb.urlAs("budmon_queue"),
      "SELECT state::text AS state FROM pgboss.job WHERE id = $1",
      [id],
    )
  )[0]?.state;
}

const yesterday = () => utcDateOf(systemClock.now()).subtract({ days: 1 }).toString();

describe("TP-9.23: stopping the worker during an active fetch (F-137, F-78, F-91, A-302)", () => {
  it("TP-9.23 (a): released 1 s after stop(): stop() resolves within 35 s, the day is stored and the job completed", async () => {
    const testDb = await createTestDatabase();
    cleanup.push(() => testDb.drop());
    const primary = heldPrimary();
    const { worker, id } = await start(testDb, primary);
    await primary.started;
    expect(await stateOf(testDb, id)).toBe("active");

    const began = Date.now();
    const stopping = worker.stop();
    setTimeout(() => {
      primary.release();
    }, 1_000);
    await stopping;

    expect(Date.now() - began).toBeLessThan(BUDGET_MS);
    expect((await storedRates(testDb)).filter((r) => r.rateDate === yesterday())).toHaveLength(1);
    await waitFor(async () => (await stateOf(testDb, id)) === "completed", 5_000, "completed");
  }, 90_000);

  it("TP-9.23 (b): never released: stop() resolves within 35 s, no rows for the day, and the job isn't completed", async () => {
    const testDb = await createTestDatabase();
    cleanup.push(() => testDb.drop());
    const primary = heldPrimary();
    const { worker, id } = await start(testDb, primary);
    await primary.started;

    const began = Date.now();
    await worker.stop();

    expect(Date.now() - began).toBeLessThan(BUDGET_MS);
    expect((await storedRates(testDb)).filter((r) => r.rateDate === yesterday())).toEqual([]);
    expect(await stateOf(testDb, id)).not.toBe("completed");
  }, 90_000);
});
