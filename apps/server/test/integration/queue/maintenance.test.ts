// F-80 platform maintenance jobs, through maintenanceHandlers(c) (A-210). TP-6.12 with A-193's
// rate-limit purge, plus extra cases TP-6.20x. IDs ending in "x" are test-architect additions, not
// LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type JobContext, type JobHandler } from "../../support/jobs.js";
import { resetBetweenTests } from "../../support/testDatabase.js";
import { buildWorkerContainer, type BuiltWorker } from "../../support/worker.js";
import { buildHandlerMap } from "../../../src/platform/queue/handlers.js";
import {
  maintenanceHandlers,
  platformMaintenanceJobs,
} from "../../../src/platform/maintenance/maintenanceJobs.js";

let built: BuiltWorker;
let handlers: ReadonlyMap<string, JobHandler>;

beforeAll(async () => {
  built = await buildWorkerContainer("general");
  handlers = maintenanceHandlers(built.container);
});

afterAll(async () => {
  await built.close();
});

beforeEach(async () => {
  await resetBetweenTests(built.testDb);
});

function context(): JobContext {
  return {
    jobId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
    attempt: 1,
    createdOn: Temporal.Now.instant(),
    logger: built.container.logger,
    signal: new AbortController().signal,
  };
}

async function run(name: string): Promise<void> {
  const handler = handlers.get(name);
  if (handler === undefined) throw new Error(`no handler for ${name}`);
  await handler({}, context());
}

async function count(sql: string): Promise<number> {
  const { rows } = await built.testDb.database.handle.executeSql(sql);
  return Number(rows[0]?.["n"]);
}

describe("TP-6.12: maintenance purges (F-80)", () => {
  it("TP-6.12: 6000 expired and 1 live idempotency record: the purge deletes 6000 and logs idempotency_purged; the live one remains", async () => {
    const h = built.testDb.database.handle;
    await h.executeSql(
      `INSERT INTO idempotency_records (user_id, idempotency_key, procedure, request_hash, expires_at)
       SELECT gen_random_uuid(), gen_random_uuid(), 'p', decode(repeat('00', 32), 'hex'), now() - interval '1 day'
       FROM generate_series(1, 6000)`,
    );
    await h.executeSql(
      `INSERT INTO idempotency_records (user_id, idempotency_key, procedure, request_hash, expires_at)
       VALUES (gen_random_uuid(), gen_random_uuid(), 'live', decode(repeat('00', 32), 'hex'), now() + interval '1 day')`,
    );
    const linesBefore = built.obs.capture.records().length;

    await run("platform.idempotency-purge");

    expect(await count("SELECT count(*)::int AS n FROM idempotency_records")).toBe(1);
    expect(
      await count("SELECT count(*)::int AS n FROM idempotency_records WHERE procedure = 'live'"),
    ).toBe(1);
    const purged = built.obs.capture
      .records()
      .slice(linesBefore)
      .filter((l) => l["event"] === "idempotency_purged");
    // A-210: one line per run, with the total (F-80 deletes in batches of 5000).
    expect(purged.map((l) => l["count"])).toEqual([6000]);
  }, 60_000);

  it("TP-6.12: (A-193) the rate-limit purge removes only the expired counters", async () => {
    const h = built.testDb.database.handle;
    await h.executeSql(
      `INSERT INTO rate_limit_counters (bucket_key, window_start, hits, expires_at)
       SELECT 'expired-' || i, now() - interval '1 hour', 1, now() - interval '1 minute'
       FROM generate_series(1, 3) AS i`,
    );
    await h.executeSql(
      `INSERT INTO rate_limit_counters (bucket_key, window_start, hits, expires_at)
       SELECT 'live-' || i, now(), 1, now() + interval '10 minutes'
       FROM generate_series(1, 2) AS i`,
    );

    const linesBefore = built.obs.capture.records().length;

    await run("platform.rate-limit-purge");

    // A-210: one rate_limits_purged line for the run.
    const purged = built.obs.capture
      .records()
      .slice(linesBefore)
      .filter((l) => l["event"] === "rate_limits_purged");
    expect(purged.map((l) => l["count"])).toEqual([3]);
    const { rows } = await h.executeSql(
      "SELECT bucket_key FROM rate_limit_counters ORDER BY bucket_key",
    );
    expect(rows.map((r) => r["bucket_key"])).toEqual(["live-1", "live-2"]);
  });
});

describe("TP-6.20x: the maintenance definitions (F-80)", () => {
  it("TP-6.20x: platformMaintenanceJobs has the idempotency, rate-limit and (from S-10) exports purges (A-210, A-215); buildHandlerMap includes the maintenance handlers", () => {
    // A-215: platform.exports-purge arrived in S-10 with F-144's handler.
    expect(platformMaintenanceJobs.map((d) => d.name).sort()).toEqual([
      "platform.exports-purge",
      "platform.idempotency-purge",
      "platform.rate-limit-purge",
    ]);
    const all = buildHandlerMap(built.container);
    for (const name of handlers.keys()) expect(all.has(name)).toBe(true);
  });

  it("TP-6.20x: idempotency-purge (0 3 * * *) and rate-limit-purge (*/10 * * * *) are general cron jobs with an empty payload, in the container's registry and the handler map", () => {
    const registry = built.container.registry;

    expect(registry.get("platform.idempotency-purge")).toMatchObject({
      role: "general",
      cron: "0 3 * * *",
    });
    expect(registry.get("platform.rate-limit-purge")).toMatchObject({
      role: "general",
      cron: "*/10 * * * *",
    });
    for (const name of ["platform.idempotency-purge", "platform.rate-limit-purge"]) {
      expect(registry.get(name)?.payload.safeParse({}).success).toBe(true);
      expect(handlers.has(name)).toBe(true);
    }
  });
});
