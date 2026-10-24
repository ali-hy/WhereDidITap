// F-77's capture pg-boss login and F-10's DB_USER rule for a capture-only worker (A-299). TP-6.16.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../../src/platform/config/schema.js";
import { createWorkerContainer } from "../../../src/platform/container.js";
import { startWorkers } from "../../../src/platform/queue/workers.js";
import { observed } from "../../support/api.js";
import { devWorker, type Fixture } from "../../support/configEnv.js";
import { TEST_JOBS, registryOf, waitFor, type JobHandler } from "../../support/jobs.js";
import { query } from "../../support/postgres.js";
import { createTestDatabase } from "../../support/testDatabase.js";
import { testWorkerConfig } from "../../support/worker.js";

describe("TP-6.16 (a): .env.example's worker values (A-299)", () => {
  it("TP-6.16 (a): WORKER_ROLES=capture,general with DB_USER=budmon_app logs no queue_error over 6 s, and a capture job completes within 10 s", async () => {
    const testDb = await createTestDatabase();
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-capture-login-"));
    const obs = observed();
    const registry = registryOf([TEST_JOBS.ok, TEST_JOBS.capture]);
    // .env.example: both roles, DB_USER budmon_app, the queue login budmon_queue.
    const c = createWorkerContainer(
      testWorkerConfig(testDb.endpoint, testDb.name, "capture,general"),
      {
        ...obs.overrides,
        registry,
      },
    );
    const handlers = new Map<string, JobHandler>([
      [TEST_JOBS.ok.name, () => Promise.resolve(undefined)],
      [TEST_JOBS.capture.name, () => Promise.resolve(undefined)],
    ]);
    const w = await startWorkers(c, handlers, { heartbeatPath: path.join(dir, "heartbeat") });
    try {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      const id = (await c.queue.enqueue(c.database.handle, TEST_JOBS.capture, { n: 1 })) ?? "";
      await waitFor(
        async () =>
          (
            await query<{ state: string }>(
              testDb.urlAs("budmon_queue"),
              "SELECT state::text AS state FROM pgboss.job WHERE id = $1",
              [id],
            )
          )[0]?.state === "completed",
        10_000,
        "the capture job",
      );

      expect(obs.capture.records().filter((l) => l["event"] === "queue_error")).toEqual([]);
    } finally {
      await w.stop();
      await c.close();
      await testDb.drop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("TP-6.16 (b), (c): DB_USER for a capture-only worker (F-10, A-299)", () => {
  function captureOnly(dbUser: string): Fixture {
    const f = devWorker();
    f.env["WORKER_ROLES"] = "capture";
    f.env["DB_USER"] = dbUser;
    return f;
  }

  function problemsOf(f: Fixture) {
    const files = Object.fromEntries(
      [...f.files].map(([p, content]) => [
        p,
        content.endsWith("\n") ? content.slice(0, -1) : content,
      ]),
    );
    const result = parseConfig("worker", { env: f.env, files });
    return result.ok ? [] : result.problems;
  }

  it("TP-6.16 (b): WORKER_ROLES=capture with DB_USER=budmon_app is one problem on DB_USER", () => {
    expect(problemsOf(captureOnly("budmon_app"))).toEqual([
      { variable: "DB_USER", rule: "must be budmon_capture for a capture-only worker" },
    ]);
  });

  it("TP-6.16 (c): WORKER_ROLES=capture with DB_USER=budmon_capture is no problem", () => {
    expect(problemsOf(captureOnly("budmon_capture"))).toEqual([]);
  });
});
