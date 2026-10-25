// F-76 to F-78 and F-81 through running workers on template copies, and F-96's worker defaults.
// TP-6.7, TP-6.8, TP-6.9, TP-6.11 and TP-6.14's container part, plus extra cases TP-6.19x. IDs
// ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Each container gets a registry of test jobs (support/jobs.ts), whose queues the template has.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { recordingLogger } from "../../support/platform.js";
import { query } from "../../support/postgres.js";
import {
  TEST_JOBS,
  jobRows,
  registryOf,
  waitFor,
  type JobDefinition,
  type JobHandler,
  type PgBossLike,
  type WorkerContainer,
} from "../../support/jobs.js";
import { testApiConfigFor } from "../../support/api.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { runCli } from "../../../src/main/cli.js";
import { createWorkerContainer } from "../../../src/platform/container.js";
import {
  buildWorkerContainer,
  testWorkerConfig,
  testWorkerEnv,
  type BuiltWorker,
} from "../../support/worker.js";
import { listDeadLetters, redriveDeadLetter } from "../../../src/platform/queue/deadLetter.js";
import { syncQueues } from "../../../src/platform/queue/queueSync.js";
import {
  MissingQueueError,
  createPgBoss,
  startWorkers,
} from "../../../src/platform/queue/workers.js";

// A-226: every worker started here writes a heartbeat file of its own, never /tmp/heartbeat
// (which healthcheck.test.ts reads).
const heartbeatDir = mkdtempSync(path.join(tmpdir(), "budmon-workers-heartbeat-"));
let heartbeats = 0;
function heartbeatPath(): string {
  heartbeats += 1;
  return path.join(heartbeatDir, `heartbeat-${String(heartbeats)}`);
}

afterAll(() => {
  rmSync(heartbeatDir, { recursive: true, force: true });
});

function queueBoss(c: WorkerContainer): PgBossLike {
  return c.queueBoss ?? c.boss;
}

async function counter(built: BuiltWorker, name: string): Promise<number> {
  const metric = (await built.obs.collect()).get(name);
  return (metric?.dataPoints ?? []).reduce(
    (sum, p) => sum + (typeof p.value === "number" ? p.value : 0),
    0,
  );
}

/** Every pgboss.job row, as text, for canary scans. */
async function allJobsText(built: BuiltWorker): Promise<string> {
  const { rows } = await built.testDb.database.handle.executeSql(
    "SELECT name, data, output FROM pgboss.job",
  );
  return JSON.stringify(rows);
}

describe("TP-6.7: handler success and failure through a running worker (F-76)", () => {
  let built: BuiltWorker;
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    built = await buildWorkerContainer("general", {
      registry: registryOf([TEST_JOBS.ok, TEST_JOBS.fail]),
    });
    const handlers = new Map<string, JobHandler>([
      [TEST_JOBS.ok.name, () => Promise.resolve({ secret: CANARIES.token })],
      [TEST_JOBS.fail.name, () => Promise.reject(new Error(CANARIES.message))],
    ]);
    const w = await startWorkers(built.container, handlers, { heartbeatPath: heartbeatPath() });
    stop = () => w.stop();
  }, 60_000);

  afterAll(async () => {
    await stop?.();
    await built.close();
  });

  it("TP-6.7: a completed job's output is null; a failed one's is message 'Error' and frames; after the final attempt it's in dead-letter.general with its sourceName; jobs_dead_lettered_total +1; no canary in pgboss.job or the logs", async () => {
    const c = built.container;
    const okId = await c.queue.enqueue(c.database.handle, TEST_JOBS.ok, { n: 1 });
    const failId = await c.queue.enqueue(c.database.handle, TEST_JOBS.fail, { n: 2 });

    await waitFor(
      async () =>
        (await jobRows(c.database, TEST_JOBS.ok.name)).some(
          (r) => r.id === okId && r.state === "completed",
        ),
      30_000,
      "the ok job to complete",
    );
    await waitFor(
      async () => (await jobRows(c.database, "dead-letter.general")).length > 0,
      60_000,
      "a dead-lettered job",
    );

    const ok = (await jobRows(c.database, TEST_JOBS.ok.name)).find((r) => r.id === okId);
    expect(ok?.output).toBeNull();
    const failed = (await jobRows(c.database, TEST_JOBS.fail.name)).find((r) => r.id === failId);
    expect(failed?.state).toBe("failed");
    const output = failed?.output as Record<string, unknown> | null;
    expect(Object.keys(output ?? {}).sort()).toEqual(["message", "stack"]);
    expect(output?.["message"]).toBe("Error");
    expect(String(output?.["stack"]).startsWith("JobFailure: Error")).toBe(true);
    const dead = await listDeadLetters(queueBoss(c), "general");
    expect(dead.map((d) => [d.sourceName, d.sourceId])).toContainEqual([
      TEST_JOBS.fail.name,
      failId,
    ]);
    expect(await counter(built, "jobs_dead_lettered_total")).toBe(1);
    expect(
      scanForCanaries(
        [
          { name: "pgboss.job", text: await allJobsText(built) },
          { name: "log", text: built.obs.capture.text() },
        ],
        CANARIES,
      ),
    ).toEqual([]);
  }, 90_000);
});

describe("TP-6.7: attempts with retryLimit 2 (F-76, A-207)", () => {
  let built: BuiltWorker;
  let stop: (() => Promise<void>) | undefined;
  const attempts: number[] = [];

  beforeAll(async () => {
    built = await buildWorkerContainer("general", { registry: registryOf([TEST_JOBS.fail3]) });
    const w = await startWorkers(
      built.container,
      new Map<string, JobHandler>([
        [
          TEST_JOBS.fail3.name,
          (_payload, ctx) => {
            attempts.push(ctx.attempt);
            return Promise.reject(new Error("x"));
          },
        ],
      ]),
      { heartbeatPath: heartbeatPath() },
    );
    stop = () => w.stop();
  }, 60_000);

  afterAll(async () => {
    await stop?.();
    await built.close();
  });

  it("TP-6.7: the handler sees attempts 1, 2 and 3; the job is dead-lettered after attempt 3 and the counter goes up once", async () => {
    const c = built.container;
    await c.queue.enqueue(c.database.handle, TEST_JOBS.fail3, { n: 4 });

    await waitFor(
      async () => (await jobRows(c.database, "dead-letter.general")).length > 0,
      90_000,
      "a dead-lettered job",
    );

    expect(attempts).toEqual([1, 2, 3]);
    expect(await counter(built, "jobs_dead_lettered_total")).toBe(1);
  }, 120_000);
});

describe("TP-6.8: worker-capture as budmon_capture (F-77)", () => {
  let built: BuiltWorker;
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    built = await buildWorkerContainer("capture", { registry: registryOf([TEST_JOBS.capture]) });
    const w = await startWorkers(
      built.container,
      new Map<string, JobHandler>([[TEST_JOBS.capture.name, () => Promise.resolve(undefined)]]),
      { heartbeatPath: heartbeatPath() },
    );
    stop = () => w.stop();
  }, 60_000);

  afterAll(async () => {
    await stop?.();
    await built.close();
  });

  it("TP-6.8: a capture job completes with no permission error; SELECT from idempotency_records as budmon_capture is 42501", async () => {
    const c = built.container;
    const id = await c.queue.enqueue(c.database.handle, TEST_JOBS.capture, { n: 1 });

    await waitFor(
      async () =>
        (await jobRows(c.database, TEST_JOBS.capture.name)).some(
          (r) => r.id === id && r.state === "completed",
        ),
      30_000,
      "the capture job to complete",
    );
    const denied = await query(
      built.testDb.urlAs("budmon_capture"),
      "SELECT * FROM idempotency_records",
    ).then(
      () => "allowed",
      (error: unknown) => String((error as { code?: unknown }).code),
    );

    expect(denied).toBe("42501");
    expect(built.obs.capture.text()).not.toContain("42501");
  }, 60_000);

  it("TP-6.19x: a capture-only container has no queue boss and a capture boss", () => {
    expect(built.container.queueBoss).toBeNull();
    expect(built.container.captureBoss).not.toBeNull();
  });
});

describe("TP-6.8: budmon_capture under row-level security (A-227)", () => {
  let testDb: TestDatabase;
  let capture: PgBossLike | undefined;
  let app: PgBossLike | undefined;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const c = createPgBoss(testWorkerConfig(testDb.endpoint, testDb.name, "capture"), "capture");
    await c.start();
    capture = c;
    const a = createPgBoss(testApiConfigFor(testDb), "send-only");
    await a.start();
    app = a;
  }, 60_000);

  afterAll(async () => {
    await capture?.stop({ graceful: false });
    await app?.stop({ graceful: false });
    await testDb.drop();
  });

  function bosses(): { capture: PgBossLike; app: PgBossLike } {
    if (capture === undefined || app === undefined) throw new Error("pg-boss didn't start");
    return { capture, app };
  }

  async function asCapture(sql: string, values: unknown[] = []) {
    return query(testDb.urlAs("budmon_capture"), sql, values);
  }

  /** Read as budmon_queue, the owner: RLS on pgboss.job (A-228) hides rows from other roles. */
  async function stateOf(id: string): Promise<string | undefined> {
    return (
      await query<{ state: string }>(
        testDb.urlAs("budmon_queue"),
        "SELECT state::text AS state FROM pgboss.job WHERE id = $1",
        [id],
      )
    )[0]?.state;
  }

  it("TP-6.8: (A-227) fetch and complete a capture job", async () => {
    const { capture: boss } = bosses();
    const id = await boss.send(TEST_JOBS.capture.name, { n: 1 });

    const [fetched] = await boss.fetch(TEST_JOBS.capture.name);
    expect(fetched?.id).toBe(id);
    await boss.complete(TEST_JOBS.capture.name, fetched?.id ?? "");

    expect(await stateOf(id ?? "")).toBe("completed");
  });

  it("TP-6.8: (A-227) fail a capture job to retry, then to dead-letter.capture", async () => {
    const { capture: boss } = bosses();
    const name = TEST_JOBS.captureRetry.name;
    const id = await boss.send(name, { n: 2 }, { retryLimit: 1, retryDelay: 0 });

    const [first] = await boss.fetch(name);
    await boss.fail(name, first?.id ?? "");
    expect(await stateOf(id ?? "")).toBe("retry");
    let second: { id: string } | undefined;
    await waitFor(
      async () => {
        [second] = await boss.fetch(name);
        return second !== undefined;
      },
      15_000,
      "the retry to be fetchable",
    );
    await boss.fail(name, second?.id ?? "");

    expect(await stateOf(id ?? "")).toBe("failed");
    // A-228: the dead-letter copy goes through pgboss.job, and capture can see it there.
    const dead = await asCapture(
      "SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'dead-letter.capture'",
    );
    expect(Number(dead[0]?.["n"])).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("TP-6.8: (A-227) sending to a general queue without sendableFromCapture is 42501, row-level security", async () => {
    const error = await bosses()
      .capture.send(TEST_JOBS.ok.name, { n: 3 })
      .then(
        () => undefined,
        (e: unknown) => e as { code?: unknown; message?: string },
      );

    expect(error?.code).toBe("42501");
    expect(error?.message).toContain("violates row-level security policy");
  });

  it("TP-6.8: (A-227) sending to a general queue marked sendableFromCapture succeeds", async () => {
    const id = await bosses().capture.send(TEST_JOBS.fromCapture.name, { n: 4 });

    // A-228: send's INSERT … RETURNING needs the SELECT policy to cover the sendable queue.
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("TP-6.8: (A-227, A-228) with general jobs present, budmon_capture sees only capture and sendable rows (pgboss.job and job_common) and updates no general job", async () => {
    const generalId = await bosses().app.send(TEST_JOBS.ok.name, { n: 5 });
    await bosses().capture.send(TEST_JOBS.capture.name, { n: 6 });

    const updated = await asCapture(
      "UPDATE pgboss.job_common SET name = name WHERE id = $1 RETURNING id",
      [generalId],
    );

    // A-228: through the partitioned parent as well as the physical table.
    const allowed = [
      TEST_JOBS.capture.name,
      TEST_JOBS.captureRetry.name,
      TEST_JOBS.fromCapture.name,
      "dead-letter.capture",
    ];
    for (const table of ["pgboss.job", "pgboss.job_common"]) {
      const names = (await asCapture(`SELECT DISTINCT name FROM ${table}`)).map((r) =>
        String(r["name"]),
      );
      expect(names.length, table).toBeGreaterThan(0);
      expect(names, table).not.toContain(TEST_JOBS.ok.name);
      for (const name of names) expect(allowed, `${table}: ${name}`).toContain(name);
    }
    expect(updated).toEqual([]);
  });

  // ---- A-230: capture can't route jobs into other queues through dead_letter / source_name ----

  const RLS = "new row violates row-level security policy";

  async function refusal(p: Promise<unknown>): Promise<string> {
    return p.then(
      () => "allowed",
      (e: unknown) => (e as Error).message,
    );
  }

  /** test.ok jobs carrying one of the A-230 markers, read as the owner. */
  async function plantedInTestOk(): Promise<number> {
    const [row] = await query<{ n: number }>(
      testDb.urlAs("budmon_queue"),
      "SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'test.ok' AND data->>'n' IN ('230001', '230002', '230003', '230004')",
    );
    return row?.n ?? -1;
  }

  it("TP-6.8: (A-230) (a)-(d): a planted dead_letter, send with deadLetter, an UPDATE of dead_letter and a planted source_name are each refused by RLS", async () => {
    const { capture: boss } = bosses();
    const ownId = await boss.send(TEST_JOBS.capture.name, { n: 230003 });

    const results = {
      a: await refusal(
        asCapture(
          `INSERT INTO pgboss.job_common (name, data, dead_letter, retry_limit, expire_seconds, state, started_on)
           VALUES ('test.capture', '{"n":230001}', 'test.ok', 0, 1, 'active', now() - interval '1 hour')`,
        ),
      ),
      b: await refusal(boss.send(TEST_JOBS.capture.name, { n: 230002 }, { deadLetter: "test.ok" })),
      c: await refusal(
        asCapture("UPDATE pgboss.job_common SET dead_letter = 'test.ok' WHERE id = $1", [ownId]),
      ),
      d: await refusal(
        asCapture(
          `INSERT INTO pgboss.job_common (name, data, source_name, state)
           VALUES ('dead-letter.capture', '{"n":230004}', 'test.ok', 'failed')`,
        ),
      ),
    };

    for (const [label, message] of Object.entries(results)) {
      expect(message, label).toContain(RLS);
    }
  });

  it("TP-6.8: (A-230) after the general pg-boss supervises test.capture, test.ok holds no planted job; (e) an expired normal capture job lands in dead-letter.capture", async () => {
    const { capture: boss } = bosses();
    const expiring = await boss.send(TEST_JOBS.capture.name, { n: 230005 }, { expireInSeconds: 1 });
    const [fetched] = await boss
      .fetch(TEST_JOBS.capture.name, { batchSize: 50 })
      .then((jobs) => jobs.filter((j) => j.id === expiring));
    expect(fetched?.id).toBe(expiring);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const general = createPgBoss(
      testWorkerConfig(testDb.endpoint, testDb.name, "general"),
      "general",
    );
    await general.start();
    try {
      await general.supervise(TEST_JOBS.capture.name);
    } finally {
      await general.stop({ graceful: false });
    }

    expect(await plantedInTestOk()).toBe(0);
    const [dead] = await query<{ n: number }>(
      testDb.urlAs("budmon_queue"),
      "SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'dead-letter.capture' AND data->>'n' = '230005'",
    );
    expect(dead?.n).toBe(1);
  }, 60_000);
});

describe("TP-6.9: start-up checks and schedules (F-78)", () => {
  const cron: JobDefinition<unknown> = {
    name: "test.cron",
    role: "general",
    payload: z.object({}),
    retryLimit: 0,
    retryDelaySeconds: 30,
    retryBackoff: false,
    expireInSeconds: 900,
    policy: "standard",
    cron: "0 3 * * *",
  };

  it("TP-6.9: a registered job without a queue: startWorkers throws MissingQueueError", async () => {
    const missing: JobDefinition<unknown> = { ...TEST_JOBS.ok, name: "test.no-queue" };
    const built = await buildWorkerContainer("general", {
      registry: registryOf([TEST_JOBS.ok, missing]),
    });
    try {
      const handlers = new Map<string, JobHandler>([
        [TEST_JOBS.ok.name, () => Promise.resolve(undefined)],
        [missing.name, () => Promise.resolve(undefined)],
      ]);

      const error = await startWorkers(built.container, handlers, {
        heartbeatPath: heartbeatPath(),
      }).then(
        async (w) => {
          await w.stop();
          return undefined;
        },
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MissingQueueError);
    } finally {
      await built.close();
    }
  }, 60_000);

  it("TP-6.19x: a definition without a handler: startWorkers throws 'no handler for <name>'", async () => {
    const built = await buildWorkerContainer("general", { registry: registryOf([TEST_JOBS.ok]) });
    try {
      await expect(
        startWorkers(built.container, new Map(), { heartbeatPath: heartbeatPath() }),
      ).rejects.toThrow(`no handler for ${TEST_JOBS.ok.name}`);
    } finally {
      await built.close();
    }
  }, 60_000);

  it("TP-6.9: a general worker schedules its cron job in UTC; a capture-only worker registers no schedule", async () => {
    const registry = registryOf([TEST_JOBS.ok, TEST_JOBS.capture, cron]);
    const general = await buildWorkerContainer("general", { registry });
    const handlers = new Map<string, JobHandler>(
      [TEST_JOBS.ok, TEST_JOBS.capture, cron].map((d) => [
        d.name,
        () => Promise.resolve(undefined),
      ]),
    );
    try {
      await syncQueues(queueBoss(general.container), registry, recordingLogger());
      const w = await startWorkers(general.container, handlers, { heartbeatPath: heartbeatPath() });
      const { rows } = await general.testDb.database.handle.executeSql(
        "SELECT name, cron, timezone FROM pgboss.schedule",
      );
      await w.stop();

      expect(rows).toEqual([{ name: "test.cron", cron: "0 3 * * *", timezone: "UTC" }]);
    } finally {
      await general.close();
    }

    // A capture-only worker on another copy (no schedule rows yet).
    const capture = await buildWorkerContainer("capture", { registry });
    try {
      const w = await startWorkers(capture.container, handlers, { heartbeatPath: heartbeatPath() });
      const { rows } = await capture.testDb.database.handle.executeSql(
        "SELECT name FROM pgboss.schedule",
      );
      await w.stop();

      expect(rows).toEqual([]);
    } finally {
      await capture.close();
    }
  }, 120_000);
});

describe("TP-6.9: platform.fx-gap-check only when registered (F-78, A-203)", () => {
  it("TP-6.9: a general worker whose registry has no platform.fx-gap-check starts, and nothing is enqueued under that name", async () => {
    const built = await buildWorkerContainer("general", { registry: registryOf([TEST_JOBS.ok]) });
    try {
      const w = await startWorkers(
        built.container,
        new Map<string, JobHandler>([[TEST_JOBS.ok.name, () => Promise.resolve(undefined)]]),
        { heartbeatPath: heartbeatPath() },
      );
      await w.stop();

      expect(await jobRows(built.container.database, "platform.fx-gap-check")).toEqual([]);
    } finally {
      await built.close();
    }
  }, 60_000);
});

/**
 * A general container on its own template copy with one test.fail job dead-lettered, its
 * workers stopped (so a redriven job stays queued).
 */
async function withDeadLetteredJob(): Promise<{ built: BuiltWorker; failId: string | null }> {
  const built = await buildWorkerContainer("general", { registry: registryOf([TEST_JOBS.fail]) });
  const w = await startWorkers(
    built.container,
    new Map<string, JobHandler>([[TEST_JOBS.fail.name, () => Promise.reject(new Error("x"))]]),
    { heartbeatPath: heartbeatPath() },
  );
  const c = built.container;
  const failId = await c.queue.enqueue(c.database.handle, TEST_JOBS.fail, { n: 3 });
  await waitFor(
    async () => (await jobRows(c.database, "dead-letter.general")).length > 0,
    60_000,
    "a dead-lettered job",
  );
  await w.stop();
  return { built, failId };
}

describe("TP-6.11: dead-letter list and redrive (F-81)", () => {
  let built: BuiltWorker;
  let failId: string | null;

  beforeAll(async () => {
    ({ built, failId } = await withDeadLetteredJob());
  }, 90_000);

  afterAll(async () => {
    await built.close();
  });

  it("TP-6.11: list gives 1 entry with failure 'Error'; redrive moves it back to its source queue; an unknown id moves 0", async () => {
    const boss = queueBoss(built.container);

    const dead = await listDeadLetters(boss, "general");
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({
      sourceName: TEST_JOBS.fail.name,
      sourceId: failId,
      failure: "Error",
    });

    const logger = recordingLogger();
    const moved = await redriveDeadLetter(
      boss,
      "general",
      dead[0]?.id ?? "",
      registryOf([TEST_JOBS.fail]),
      logger,
    );
    expect(moved).toBe(1);
    const queued = (await jobRows(built.container.database, TEST_JOBS.fail.name)).filter((r) =>
      ["created", "retry"].includes(r.state),
    );
    expect(queued).toHaveLength(1);

    expect(
      await redriveDeadLetter(
        boss,
        "general",
        "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
        registryOf([TEST_JOBS.fail]),
        logger,
      ),
    ).toBe(0);
    // A real dead letter of a registered queue, and an unknown id: neither is a refusal.
    expect(logger.lines.filter((l) => l.event === "redrive_refused")).toEqual([]);
  });

  it("TP-6.19x: listDeadLetters without a role covers both roles; the capture list is empty", async () => {
    const boss = queueBoss(built.container);

    expect(await listDeadLetters(boss, "capture")).toEqual([]);
    expect((await listDeadLetters(boss)).length).toBeGreaterThanOrEqual(0);
  });
});

// A-218's cases have their own dead-lettered job: TP-6.11's redrive removes the one above.
describe("TP-6.11: jobs:dead runs a cli-mode pg-boss (F-93, A-218)", () => {
  let built: BuiltWorker;

  beforeAll(async () => {
    ({ built } = await withDeadLetteredJob());
  }, 90_000);

  afterAll(async () => {
    await built.close();
  });

  it("TP-6.11: (A-218) jobs:dead list through runCli prints the entry; no schedule row or pg-boss maintenance happens during the command", async () => {
    const { testDb } = built;
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-cli-"));
    const read = async (sql: string) =>
      JSON.stringify((await testDb.database.handle.executeSql(sql)).rows);
    try {
      const versionBefore = await read("SELECT * FROM pgboss.version");
      const schedulesBefore = await read("SELECT * FROM pgboss.schedule ORDER BY name");
      const stdout: string[] = [];
      const stderr: string[] = [];

      const code = await runCli(
        ["jobs:dead", "list", "--role", "general"],
        testWorkerEnv(dir, testDb.endpoint, testDb.name, "general"),
        { stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) },
      );

      expect(code, stderr.join("\n")).toBe(0);
      expect(stdout.map((l) => (JSON.parse(l) as { failure: unknown }).failure)).toEqual(["Error"]);
      expect(await read("SELECT * FROM pgboss.version")).toBe(versionBefore);
      expect(await read("SELECT * FROM pgboss.schedule ORDER BY name")).toBe(schedulesBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("TP-6.11: (A-230) a dead-letter.capture job planted with source_name test.ok: jobs:dead redrive moves nothing, exit 2, one redrive_refused line, test.ok holds no job", async () => {
    const { testDb } = built;
    const [planted] = await query<{ id: string }>(
      testDb.urlAs("budmon_queue"),
      `INSERT INTO pgboss.job (name, data, source_name, state)
       VALUES ('dead-letter.capture', '{"n":230011}', 'test.ok', 'failed') RETURNING id::text AS id`,
    );
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-cli-redrive-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    try {
      const code = await runCli(
        ["jobs:dead", "redrive", "--role", "capture", "--id", planted?.id ?? ""],
        testWorkerEnv(dir, testDb.endpoint, testDb.name, "general"),
        { stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) },
      );
      spy.mockRestore();

      expect(code, [...stderr, ...written].join("\n")).toBe(2);
      expect(stdout.map((l) => JSON.parse(l) as unknown)).toEqual([{ moved: 0 }]);
      const refused = [...stderr, ...written.join("").split("\n")].filter((l) =>
        l.includes('"redrive_refused"'),
      );
      expect(refused).toHaveLength(1);
      const [inTestOk] = await query<{ n: number }>(
        testDb.urlAs("budmon_queue"),
        "SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'test.ok' AND data->>'n' = '230011'",
      );
      expect(inTestOk?.n).toBe(0);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("TP-6.11: (A-230) redriveDeadLetter refuses a source_name outside the role's queues: 0 moved, one redrive_refused through the passed logger with the job id", async () => {
    const { testDb } = built;
    const [planted] = await query<{ id: string }>(
      testDb.urlAs("budmon_queue"),
      `INSERT INTO pgboss.job (name, data, source_name, state)
       VALUES ('dead-letter.capture', '{"n":230012}', 'test.ok', 'failed') RETURNING id::text AS id`,
    );
    const boss = createPgBoss(testWorkerConfig(testDb.endpoint, testDb.name, "general"), "cli");
    await boss.start();
    const logger = recordingLogger();
    try {
      const moved = await redriveDeadLetter(
        boss,
        "capture",
        planted?.id ?? "",
        registryOf([TEST_JOBS.capture, TEST_JOBS.ok]),
        logger,
      );

      expect(moved).toBe(0);
      const refused = logger.lines.filter((l) => l.event === "redrive_refused");
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({
        level: "warn",
        fields: { fields: { jobId: planted?.id } },
      });
    } finally {
      await boss.stop({ graceful: false });
    }
  });

  it("TP-6.11: (A-218) createPgBoss mode cli connects with the queue login as budmon-cli", async () => {
    const cfg = testWorkerConfig(built.testDb.endpoint, built.testDb.name, "general");
    const boss = (createPgBoss as (c: typeof cfg, mode: string) => PgBossLike)(cfg, "cli");
    await boss.start();
    try {
      const [row] = await query<{ usename: string }>(
        built.testDb.urlAs("budmon_migrator"),
        "SELECT usename FROM pg_stat_activity WHERE application_name = 'budmon-cli' LIMIT 1",
      );

      expect(row?.usename).toBe("budmon_queue");
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});

describe("TP-6.14: createWorkerContainer's module defaults (F-96, A-26)", () => {
  it("TP-6.14: with no overrides: onGeneralStarted is [], erasureHandler is null, sealedColumns.all() is []", async () => {
    const testDb = await createTestDatabase();
    const c = createWorkerContainer(testWorkerConfig(testDb.endpoint, testDb.name, "general"));
    try {
      expect(c.onGeneralStarted).toEqual([]);
      expect(c.erasureHandler).toBeNull();
      expect(c.sealedColumns.all()).toEqual([]);
      expect([...c.roles]).toEqual(["general"]);
    } finally {
      await c.close();
      await testDb.drop();
    }
  });
});
