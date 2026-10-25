// F-76 wrapHandler and JobFailure, with fake jobs. Extra cases TP-6.21x (TP-6.7 and TP-6.17 check
// the same through a running worker). A-297: one disposition per job (perJobResults). IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// A job here is pg-boss's work-handler item with metadata: { id, name, data, retryCount,
// createdOn }. The attempt is taken to be retryCount + 1 (see the open question in the report).
import { fixedClock } from "@budmon/shared";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BudmonError } from "../../../src/platform/errors/BudmonError.js";
import { observed } from "../../support/api.js";
import { type JobDefinition } from "../../support/jobs.js";
import { JobFailure, wrapHandler } from "../../../src/platform/queue/wrapper.js";

const DEF: JobDefinition<{ n: number }> = {
  name: "test.wrapped",
  role: "general",
  payload: z.object({ n: z.number().int() }),
  retryLimit: 1,
  retryDelaySeconds: 0,
  retryBackoff: false,
  expireInSeconds: 900,
  policy: "standard",
};

type WorkJob = Parameters<ReturnType<typeof wrapHandler>>[0][number];

function fakeJob(data: unknown, retryCount = 0): WorkJob {
  return {
    id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
    data: data as WorkJob["data"],
    retryCount,
    createdOn: new Date("2026-10-09T12:00:00Z"),
  };
}

function wrapped(
  handler: (payload: { n: number }) => Promise<unknown>,
  def: JobDefinition<{ n: number }> = DEF,
) {
  const obs = observed();
  const run = wrapHandler(def, handler, {
    logger: obs.overrides.logger,
    metrics: obs.metrics,
    reporter: obs.reporter,
    clock: fixedClock("2026-10-09T12:00:05Z"),
  });
  return { run, obs };
}

/** A-297: the one job's disposition, with its output when it has one. */
async function dispositionOf(
  results: Promise<{ id: string; status: string; output?: Error }[]>,
): Promise<{ id: string; status: string; output?: Error }> {
  const all = await results;
  expect(all).toHaveLength(1);
  const [only] = all;
  if (only === undefined) throw new Error("no disposition");
  return only;
}

/** A failed or dead-lettered job's stored output (a JobFailure). */
async function failureOf(
  results: Promise<{ id: string; status: string; output?: Error }[]>,
  status: "failed" | "deadletter" = "failed",
): Promise<Error> {
  const d = await dispositionOf(results);
  expect(d.status).toBe(status);
  if (d.output === undefined) throw new Error("no output");
  return d.output;
}

async function counterTotal(obs: ReturnType<typeof observed>, name: string): Promise<number> {
  const metric = (await obs.collect()).get(name);
  return (metric?.dataPoints ?? []).reduce(
    (sum, p) => sum + (typeof p.value === "number" ? p.value : 0),
    0,
  );
}

describe("TP-6.21x: wrapHandler (F-76)", () => {
  it("TP-6.21x: the handler gets the parsed payload and a context; its return value is discarded", async () => {
    const handler = vi.fn(() => Promise.resolve({ secret: CANARIES.token }));
    const { run } = wrapped(handler);

    await expect(run([fakeJob({ n: 3 })])).resolves.toEqual([
      { id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b", status: "completed" },
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
    const [payload, ctx] = handler.mock.calls[0] as unknown as [
      unknown,
      { jobId: string; attempt: number; signal: unknown; logger: unknown },
    ];
    expect(payload).toEqual({ n: 3 });
    expect(ctx.jobId).toBe("0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b");
    expect(ctx.attempt).toBe(1);
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
  });

  it("TP-6.21x: a success records jobs_processed_total and job_duration_seconds", async () => {
    const { run, obs } = wrapped(() => Promise.resolve(undefined));

    await run([fakeJob({ n: 1 })]);

    const metrics = await obs.collect();
    expect(metrics.get("jobs_processed_total")?.dataPoints.length).toBeGreaterThan(0);
    expect(metrics.get("job_duration_seconds")?.dataPoints.length).toBeGreaterThan(0);
  });

  it("TP-6.21x: a thrown Error becomes a JobFailure with message 'Error', frames only, no other own properties; job_failed is logged; it's reported", async () => {
    const { run, obs } = wrapped(() =>
      Promise.reject(Object.assign(new Error(CANARIES.message), { payee: CANARIES.payee })),
    );

    const failure = await failureOf(run([fakeJob({ n: 1 })]));

    expect(failure).toBeInstanceOf(JobFailure);
    expect(failure.message).toBe("Error");
    expect(Object.getOwnPropertyNames(failure).sort()).toEqual(["message", "stack"]);
    expect(failure.stack?.startsWith("JobFailure: Error")).toBe(true);
    const lines = obs.capture.records().filter((l) => l["event"] === "job_failed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ jobName: DEF.name, attempt: 1, errorClass: "Error" });
    expect(obs.reporter.events).toHaveLength(1);
    expect(
      scanForCanaries(
        [
          { name: "failure", text: `${failure.message}\n${failure.stack ?? ""}` },
          { name: "log", text: obs.capture.text() },
          { name: "report", text: JSON.stringify(obs.reporter.events) },
        ],
        CANARIES,
      ),
    ).toEqual([]);
  });

  it("TP-6.21x: a BudmonError fails with its key and isn't reported", async () => {
    const { run, obs } = wrapped(() =>
      Promise.reject(new BudmonError("CONFLICT", 409, "Conflict")),
    );

    const failure = await failureOf(run([fakeJob({ n: 1 })]));

    expect(failure.message).toBe("CONFLICT");
    expect(obs.reporter.events).toHaveLength(0);
  });

  it("TP-6.21x (A-297): a payload that doesn't parse is dead-lettered on its first attempt without calling the handler, and holds no data", async () => {
    const handler = vi.fn(() => Promise.resolve(undefined));
    const { run, obs } = wrapped(handler);

    const failure = await failureOf(run([fakeJob({ n: CANARIES.payee })]), "deadletter");

    expect(handler).not.toHaveBeenCalled();
    expect(failure.message).toBe("JobPayloadInvalidError");
    expect(failure.message).not.toContain(CANARIES.payee);
    const lines = obs.capture.records().filter((l) => l["event"] === "job_failed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ outcome: "dead_lettered" });
    expect(await counterTotal(obs, "jobs_dead_lettered_total")).toBe(1);
    expect(scanForCanaries([{ name: "log", text: obs.capture.text() }], CANARIES)).toEqual([]);
  });

  it("TP-6.21x: the last attempt's failure increments jobs_dead_lettered_total; an earlier one doesn't", async () => {
    const first = wrapped(() => Promise.reject(new Error("x")));
    await failureOf(first.run([fakeJob({ n: 1 }, 0)]));
    expect(await counterTotal(first.obs, "jobs_dead_lettered_total")).toBe(0);

    const last = wrapped(() => Promise.reject(new Error("x")));
    await failureOf(last.run([fakeJob({ n: 1 }, 1)]));
    expect(await counterTotal(last.obs, "jobs_dead_lettered_total")).toBe(1);
  });
});
