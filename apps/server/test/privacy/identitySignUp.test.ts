// The privacy canary suite (identity LLD §10.1). TP-1.35: previewing and accepting an invitation
// for a canary email, with a canary password and name, through the real HTTP layer, and the same
// with a refused profile and a refused password. Logs, spans, metrics, error reports and the
// jobs' data and output hold no canary.
import { createRequire } from "node:module";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { IdentityApi } from "../support/identity.js";
import type { InMemoryTelemetry } from "../support/telemetry.js";

let telemetry: InMemoryTelemetry;
let shutdown: () => Promise<void>;
let api: IdentityApi | undefined;

const NOW = Temporal.Instant.from("2026-11-02T10:00:00Z");
/** 17 + 9 characters, not common, without the email's local part. */
const CANARY_PASSWORD = `${CANARIES.message} long pass`;

beforeAll(async () => {
  const { inMemoryTelemetry } = await import("../support/telemetry.js");
  telemetry = inMemoryTelemetry();
  const { startTelemetry } = await import("../../src/platform/observability/otel.js");
  const started = startTelemetry(
    { service: "api", release: "v1.2.3", environment: "test" },
    {
      onDrop: vi.fn(),
      traceExporter: telemetry.traceExporter,
      metricReader: telemetry.metricReader,
    },
  );
  let stopped: Promise<void> | undefined;
  shutdown = () => (stopped ??= started.shutdown());
  createRequire(import.meta.url)("pg");

  const { buildIdentityApi } = await import("../support/identity.js");
  api = await buildIdentityApi();
  await api.container.boss.start();
}, 120_000);

afterAll(async () => {
  await api?.close();
  await shutdown();
});

describe("TP-1.35: sign-up leaks no canary", () => {
  it("TP-1.35: preview, a refused profile, a refused password and a successful accept with canary values: nothing captured holds a canary", async () => {
    const { invitationFactory } = await import("../factories/identity.js");
    const { call } = await import("../support/identityHttp.js");
    if (api === undefined) throw new Error("the API wasn't built");
    const built = api;
    const h = built.testDb.database.handle;
    const { token } = await invitationFactory(h, {
      email: CANARIES.email,
      now: NOW,
      withToken: true,
    });
    if (token === null) throw new Error("no token");
    const body = (over: Record<string, unknown>) => ({
      token,
      displayName: CANARIES.payee,
      locale: "en",
      timeZone: "Africa/Cairo",
      baseCurrency: "USD",
      method: { kind: "password", password: CANARY_PASSWORD },
      tokenDelivery: "body",
      ...over,
    });

    const previewed = await call(built.app, "POST", "/invitations/preview", { token });
    const badProfile = await call(
      built.app,
      "POST",
      "/invitations/accept",
      body({ displayName: `${CANARIES.payee}${"x".repeat(80)}`, timeZone: CANARIES.message }),
    );
    const badPassword = await call(
      built.app,
      "POST",
      "/invitations/accept",
      body({ method: { kind: "password", password: CANARIES.payee.slice(0, 11) } }),
    );
    const accepted = await call(built.app, "POST", "/invitations/accept", body({}));
    await shutdown();

    // The four requests ran as intended.
    expect(previewed.status).toBe(200);
    expect(badProfile.status).toBe(400);
    expect(badPassword.status).toBe(400);
    expect(accepted.status).toBe(200);

    const jobs = (
      await h.executeSql("SELECT name, data, output FROM pgboss.job WHERE name LIKE 'identity.%'")
    ).rows;
    const hits = scanForCanaries(
      [
        { name: "logs", text: built.obs.capture.lines().join("\n") },
        { name: "reports", text: JSON.stringify(built.obs.reporter.events) },
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
        {
          name: "container metrics",
          text: JSON.stringify([...(await built.obs.collect()).values()]),
        },
        { name: "jobs", text: JSON.stringify(jobs) },
      ],
      CANARIES,
    );
    expect(hits).toEqual([]);
  }, 120_000);
});
