// The privacy canary suite (identity LLD §10.1). TP-3.27: signing in with a canary email and a
// canary password (wrong, then right, with a canary device model), then refreshing, through the
// real HTTP layer. Logs, spans, metrics, error reports and the jobs' data and output hold no
// canary.
import { createRequire } from "node:module";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { IdentityApi } from "../support/identity.js";
import type { InMemoryTelemetry } from "../support/telemetry.js";

let telemetry: InMemoryTelemetry;
let shutdown: () => Promise<void>;
let api: IdentityApi | undefined;

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

describe("TP-3.27: sign-in and refresh leak no canary", () => {
  it("TP-3.27: a wrong and a right canary password for a canary email, then a refresh: nothing captured holds a canary", async () => {
    const { userFactory, passwordFactory } = await import("../factories/identity.js");
    const { call } = await import("../support/identityHttp.js");
    if (api === undefined) throw new Error("the API wasn't built");
    const built = api;
    const h = built.testDb.database.handle;
    const user = await userFactory(h, { email: CANARIES.email, displayName: CANARIES.payee });
    await passwordFactory(
      h,
      user.id,
      await built.container.identity.deps.hasher.hash(CANARY_PASSWORD),
    );
    const signIn = (password: string) =>
      call(built.app, "POST", "/auth/sign-in", {
        email: CANARIES.email,
        password,
        tokenDelivery: "body",
        deviceModel: CANARIES.payee,
      });

    const wrong = await signIn(`${CANARIES.message} wrong one`);
    const right = await signIn(CANARY_PASSWORD);
    const refreshToken = (right.json() as { tokens: { refreshToken: string } }).tokens.refreshToken;
    const refreshed = await call(built.app, "POST", "/auth/refresh", {
      tokenDelivery: "body",
      refreshToken,
    });
    await shutdown();

    // The three requests ran as intended.
    expect(wrong.status).toBe(401);
    expect(right.status).toBe(200);
    expect(refreshed.status).toBe(200);

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
