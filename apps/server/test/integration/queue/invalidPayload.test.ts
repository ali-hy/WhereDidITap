// F-76 and F-78 with perJobResults (A-297): a payload that doesn't parse is dead-lettered at once;
// a handler failure still retries. TP-6.17.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startWorkers } from "../../../src/platform/queue/workers.js";
import { TEST_JOBS, registryOf, waitFor, type JobHandler } from "../../support/jobs.js";
import { query } from "../../support/postgres.js";
import { buildWorkerContainer, type BuiltWorker } from "../../support/worker.js";

const heartbeatDir = mkdtempSync(path.join(tmpdir(), "budmon-perjob-heartbeat-"));
let built: BuiltWorker;
let stop: (() => Promise<void>) | undefined;
let failOnce = true;
const handler = vi.fn<JobHandler>(() => {
  if (failOnce) {
    failOnce = false;
    return Promise.reject(new Error("once"));
  }
  return Promise.resolve(undefined);
});

beforeAll(async () => {
  built = await buildWorkerContainer("general", { registry: registryOf([TEST_JOBS.parse]) });
  const w = await startWorkers(built.container, new Map([[TEST_JOBS.parse.name, handler]]), {
    heartbeatPath: path.join(heartbeatDir, "heartbeat"),
  });
  stop = () => w.stop();
}, 60_000);

afterAll(async () => {
  await stop?.();
  await built.close();
  rmSync(heartbeatDir, { recursive: true, force: true });
});

async function job(id: string) {
  const [row] = await query<{ state: string; retry_count: number; output: unknown }>(
    built.testDb.urlAs("budmon_queue"),
    "SELECT state::text AS state, retry_count, output FROM pgboss.job WHERE id = $1",
    [id],
  );
  return row;
}

async function deadLettered(queue: string): Promise<number> {
  const metric = (await built.obs.collect()).get("jobs_dead_lettered_total");
  return (metric?.dataPoints ?? [])
    .filter((p) => p.attributes["queue"] === queue)
    .reduce((sum, p) => sum + (typeof p.value === "number" ? p.value : 0), 0);
}

describe("TP-6.17: perJobResults (F-76, F-78, A-297)", () => {
  it('TP-6.17: a row planted with data {"n":"x"} isn\'t handled, is in dead-letter.general after one attempt (retry_count 0), counts jobs_dead_lettered_total once, logs job_failed outcome dead_lettered, and stores only { message: "JobPayloadInvalidError", stack }', async () => {
    const [planted] = await query<{ id: string }>(
      built.testDb.urlAs("budmon_queue"),
      `INSERT INTO pgboss.job (name, data, retry_limit, retry_delay, retry_backoff, expire_seconds,
                               deletion_seconds, keep_until, dead_letter, policy)
       SELECT q.name, '{"n":"x"}'::jsonb, q.retry_limit, q.retry_delay,
              COALESCE(q.retry_backoff, false), q.expire_seconds, q.deletion_seconds,
              now() + q.retention_seconds * interval '1 second', q.dead_letter, q.policy
       FROM pgboss.queue q WHERE q.name = $1
       RETURNING id::text AS id`,
      [TEST_JOBS.parse.name],
    );
    const id = planted?.id ?? "";

    await waitFor(async () => (await job(id))?.state === "failed", 20_000, "the planted job");

    const row = await job(id);
    expect(row?.retry_count).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    const output = row?.output as Record<string, unknown>;
    expect(Object.keys(output).sort()).toEqual(["message", "stack"]);
    expect(output["message"]).toBe("JobPayloadInvalidError");
    const copies = (
      await query<{ data: unknown }>(
        built.testDb.urlAs("budmon_queue"),
        "SELECT data FROM pgboss.job WHERE name = 'dead-letter.general'",
      )
    ).filter((r) => JSON.stringify(r.data) === '{"n":"x"}');
    expect(copies).toHaveLength(1);
    expect(await deadLettered(TEST_JOBS.parse.name)).toBe(1);
    expect(
      built.obs.capture
        .records()
        .filter((l) => l["event"] === "job_failed" && l["outcome"] === "dead_lettered"),
    ).toHaveLength(1);
  }, 60_000);

  it("TP-6.17: a valid job whose handler throws once is retried once, then completed with no output", async () => {
    const c = built.container;
    const id = (await c.queue.enqueue(c.database.handle, TEST_JOBS.parse, { n: 1 })) ?? "";

    await waitFor(async () => (await job(id))?.state === "completed", 30_000, "the valid job");

    const row = await job(id);
    expect(row?.retry_count).toBe(1);
    expect(row?.output).toBeNull();
    expect(handler).toHaveBeenCalledTimes(2);
  }, 60_000);
});
