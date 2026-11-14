// The privacy canary suite (identity LLD §10.1). TP-0.24: the invitation and reset email jobs, run
// by real pg-boss workers, for a canary recipient (and a canary inviter name), through F-30's SMTP
// sender over a fake transport that succeeds, fails permanently and fails transiently with the
// recipient in its error. Logs, spans, metrics, error reports and pgboss.job.output hold no canary.
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { IdentityWorker } from "../support/identity.js";
import type { InMemoryTelemetry } from "../support/telemetry.js";

let telemetry: InMemoryTelemetry;
let shutdown: () => Promise<void>;
let w: IdentityWorker | undefined;
let stopWorkers: (() => Promise<void>) | undefined;
const sendMail = vi.fn();

const NOW = Temporal.Instant.from("2026-11-02T10:00:00Z");

beforeAll(async () => {
  const { inMemoryTelemetry } = await import("../support/telemetry.js");
  telemetry = inMemoryTelemetry();
  const { startTelemetry } = await import("../../src/platform/observability/otel.js");
  const started = startTelemetry(
    { service: "worker-general", release: "v1.2.3", environment: "test" },
    {
      onDrop: vi.fn(),
      traceExporter: telemetry.traceExporter,
      metricReader: telemetry.metricReader,
    },
  );
  let stopped: Promise<void> | undefined;
  // Called in the test (to flush spans) and again in afterAll.
  shutdown = () => (stopped ??= started.shutdown());
  createRequire(import.meta.url)("pg");

  const { buildIdentityWorker } = await import("../support/identity.js");
  const { createSmtpEmailSender } = await import("../../src/identity/emailSender.js");
  const { buildHandlerMap } = await import("../../src/platform/queue/handlers.js");
  const { startWorkers } = await import("../../src/platform/queue/workers.js");
  const sender = createSmtpEmailSender(
    {
      smtpUrl: new URL("smtp://localhost:1025"),
      smtpTransport: { security: "none", host: "localhost", port: 1025 },
      from: "Budmon <no-reply@budmon.local>",
      publicOrigin: new URL("http://localhost:5173"),
    },
    "test",
    { createTransport: (() => ({ sendMail })) as never },
  );
  w = await buildIdentityWorker({ identityOverrides: { sender } });
  const built = w;
  const workers = await startWorkers(built.container, buildHandlerMap(built.container), {
    heartbeatPath: path.join(mkdtempSync(path.join(tmpdir(), "budmon-hb-")), "heartbeat"),
  });
  stopWorkers = () => workers.stop();
}, 120_000);

afterAll(async () => {
  await stopWorkers?.();
  await w?.close();
  await shutdown();
});

describe("TP-0.24: identity's email jobs leak no canary", () => {
  it("TP-0.24: invitation sent, reset failing permanently, reset failing transiently: nothing captured holds a canary", async () => {
    const { invitationFactory, resetFactory, userFactory } =
      await import("../factories/identity.js");
    const { identityJobs } = await import("../../src/identity/identityJobs.js");
    const { jobRows, waitFor } = await import("../support/jobs.js");
    if (w === undefined) throw new Error("the worker wasn't built");
    const worker = w;
    const c = worker.container;
    const h = c.database.handle;
    const inviter = await userFactory(h, { displayName: CANARIES.payee });
    const { invitationId } = await invitationFactory(h, {
      email: CANARIES.email,
      now: NOW,
      inviterUserId: inviter.id,
    });
    const recipient = await userFactory(h, { email: CANARIES.email });
    const permanent = await resetFactory(h, { userId: recipient.id, now: NOW });
    const transient = await resetFactory(h, { userId: recipient.id, now: NOW });
    const smtpError = (responseCode: number, code: string) =>
      Object.assign(new Error(`${String(responseCode)} <${CANARIES.email}> ${CANARIES.message}`), {
        responseCode,
        code,
        response: `${String(responseCode)} ${CANARIES.email}`,
        rejected: [CANARIES.email],
      });
    sendMail
      .mockImplementationOnce(() => Promise.resolve({ accepted: [CANARIES.email] }))
      .mockImplementationOnce(() => Promise.reject(smtpError(550, "EENVELOPE")))
      .mockImplementationOnce(() => Promise.reject(smtpError(421, "ECONNECTION")));

    const invitationJob = await c.queue.enqueue(h, identityJobs.emailSend, {
      kind: "invitation",
      refId: invitationId,
    });
    await waitFor(
      async () =>
        (await jobRows(c.database, "identity.email-send")).some(
          (r) => r.id === invitationJob && r.state === "completed",
        ),
      30_000,
      "the invitation email",
    );
    const permanentJob = await c.queue.enqueue(h, identityJobs.emailSend, {
      kind: "password_reset",
      refId: permanent.resetId,
    });
    await waitFor(
      async () =>
        (await jobRows(c.database, "identity.email-send")).some(
          (r) => r.id === permanentJob && r.state === "completed",
        ),
      30_000,
      "the permanently failing reset",
    );
    const transientJob = await c.queue.enqueue(h, identityJobs.emailSend, {
      kind: "password_reset",
      refId: transient.resetId,
    });
    await waitFor(
      async () =>
        (await jobRows(c.database, "identity.email-send")).some(
          (r) => r.id === transientJob && (r.state === "retry" || r.state === "failed"),
        ),
      30_000,
      "the transiently failing reset",
    );
    await shutdown();

    // The three flows ran as intended.
    expect(sendMail).toHaveBeenCalledTimes(3);
    const lines = worker.obs.capture.records();
    expect(lines.some((l) => l["event"] === "email_failed")).toBe(true);
    const rows = await jobRows(c.database, "identity.email-send");
    expect(rows.find((r) => r.id === transientJob)?.output).not.toBeNull();

    const hits = scanForCanaries(
      [
        { name: "logs", text: worker.obs.capture.lines().join("\n") },
        { name: "reports", text: JSON.stringify(worker.obs.reporter.events) },
        {
          name: "spans",
          text: JSON.stringify(
            telemetry.traceExporter.spans.map((s) => ({
              name: s.name,
              attributes: s.attributes,
              events: s.events,
              status: s.status,
            })),
          ),
        },
        { name: "metrics", text: telemetry.metricsText() },
        { name: "job output", text: JSON.stringify(rows.map((r) => r.output)) },
        { name: "job data", text: JSON.stringify(rows.map((r) => r.data)) },
      ],
      CANARIES,
    );
    expect(hits).toEqual([]);
  }, 120_000);
});
