// TP-3.12 (moved from S-2's TP-2.10, A-51): F-15 with real tracing. With startTelemetry's pg
// instrumentation and an in-memory span exporter, F-15 run with password forms whose password is
// CANARIES.token exports no span carrying the canary and no span for its ALTER ROLE statements,
// while spans for its other queries still exist.
//
// The pg instrumentation patches `pg` when it's loaded, so nothing here loads `pg` before
// startTelemetry: the support and application modules are imported dynamically afterwards.
// The pg instrumentation needs a parent span (requireParentSpan: true), so F-15 runs inside one.
import { createRequire } from "node:module";
import { trace } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inMemoryTelemetry, type InMemoryTelemetry } from "../../support/telemetry.js";

const DATABASE = "budmon";
const MIGRATOR_PASSWORD = "role-spans-migrator-password";

let telemetry: InMemoryTelemetry;
let stopPostgres: (() => Promise<void>) | undefined;

beforeAll(async () => {
  telemetry = inMemoryTelemetry();
  const { startTelemetry } = await import("../../../src/platform/observability/otel.js");
  const started = startTelemetry(
    { service: "migrate", release: "v1.2.3", environment: "test" },
    {
      onDrop: () => undefined,
      traceExporter: telemetry.traceExporter,
      metricReader: telemetry.metricReader,
    },
  );
  // First load of pg, after the instrumentation's hook is in place.
  createRequire(import.meta.url)("pg");

  const { startFreshPostgres, LOGIN_ROLES } = await import("../../support/postgres.js");
  const { connectDatabase, recordingLogger } = await import("../../support/platform.js");
  const { bootstrapCluster } = await import("../../../src/platform/db/clusterBootstrap.js");
  const { applyRolesAndPrivileges } = await import("../../../src/platform/db/roles.js");

  const pg = await startFreshPostgres();
  stopPostgres = () => pg.stop();
  const client = await pg.superuserClient();
  try {
    await bootstrapCluster(client, {
      databaseName: DATABASE,
      migrator: { password: MIGRATOR_PASSWORD },
    });
  } finally {
    await client.end();
  }
  const migrator = connectDatabase(pg, "budmon_migrator", MIGRATOR_PASSWORD, DATABASE);
  type Secrets = Parameters<typeof applyRolesAndPrivileges>[1];
  const secrets = Object.fromEntries(
    LOGIN_ROLES.map((role) => [role, { password: CANARIES.token }]),
  ) as Secrets;
  secrets.budmon_migrator = { password: MIGRATOR_PASSWORD };
  // budmon_migrator keeps the password the test logs in with; every other role gets the canary.

  try {
    await trace.getTracer("tp-3.12").startActiveSpan("tp-3.12", async (span) => {
      try {
        await applyRolesAndPrivileges(migrator.handle, secrets, "test", recordingLogger([]));
      } finally {
        span.end();
      }
    });
  } finally {
    await migrator.close();
  }
  await started.shutdown();
}, 240_000);

afterAll(async () => {
  await stopPostgres?.();
});

function spanText(spans: readonly ReadableSpan[]): string {
  return JSON.stringify(
    spans.map((s) => ({
      name: s.name,
      attributes: s.attributes,
      events: s.events,
      status: s.status,
    })),
  );
}

function databaseSpans(): ReadableSpan[] {
  return telemetry.traceExporter.spans.filter(
    (s) => s.attributes["db.system.name"] !== undefined || /^(pg|postgres)/i.test(s.name),
  );
}

describe("TP-3.12: F-15 under the pg instrumentation", () => {
  it("TP-3.12: no exported span carries the canary", () => {
    expect(
      scanForCanaries([{ name: "spans", text: spanText(telemetry.traceExporter.spans) }], CANARIES),
    ).toEqual([]);
  });

  it("TP-3.12: no span exists for the ALTER ROLE statements", () => {
    const alterRole = telemetry.traceExporter.spans.filter((s) =>
      /ALTER\s+ROLE/i.test(`${s.name} ${String(s.attributes["db.query.text"] ?? "")}`),
    );

    expect(alterRole).toEqual([]);
  });

  it("TP-3.12: spans for F-15's other queries still exist", () => {
    expect(databaseSpans().length).toBeGreaterThan(0);
  });
});
