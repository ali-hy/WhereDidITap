// F-40 with the real instrumented stack (F-36, F-55). TP-4.21: requests through the full API with
// startTelemetry and an in-memory trace exporter produce no unexpected span-attribute drops, and no
// exported span holds url.full, user_agent.original or the query.
//
// The SDK's instrumentations patch modules when they're loaded, so the server, Fastify and pg are
// imported only after startTelemetry.
import { createRequire } from "node:module";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inMemoryTelemetry, type InMemoryTelemetry } from "../../support/telemetry.js";

let telemetry: InMemoryTelemetry;
const onDrop = vi.fn<(signal: string, kind: string, n: number) => void>();
let shutdown: () => Promise<void>;
let app: FastifyInstance;
let close: () => Promise<void>;
const statuses: number[] = [];

beforeAll(async () => {
  telemetry = inMemoryTelemetry();
  const { startTelemetry } = await import("../../../src/platform/observability/otel.js");
  const started = startTelemetry(
    { service: "api", release: "v1.2.3", environment: "test" },
    { onDrop, traceExporter: telemetry.traceExporter, metricReader: telemetry.metricReader },
  );
  shutdown = () => started.shutdown();
  const require = createRequire(import.meta.url);
  require("pg");
  require("fastify");

  const { buildApiContainer } = await import("../../support/api.js");
  const { testContract, testRouter } = await import("../../support/testRouter.js");
  const { createApiServer } = await import("../../../src/platform/http/server.js");
  const built = await buildApiContainer();
  app = await createApiServer(built.container, {
    contract: testContract,
    router: testRouter().router as never,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  close = async () => {
    await app.close();
    await built.close();
  };
  const address = app.server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${String(port)}`;

  for (const url of [`${base}/api/v1/meta/client-config?x=1`, `${base}/api/v1/test/query`]) {
    const res = await fetch(url, { headers: { "user-agent": "budmon-test/1.0 (TP-4.21)" } });
    await res.text();
    statuses.push(res.status);
  }
  await shutdown();
}, 120_000);

afterAll(async () => {
  await close();
});

describe("TP-4.21: no unexpected span-attribute drops through the real stack", () => {
  it("TP-4.21: both requests succeeded and produced spans", () => {
    expect(statuses).toEqual([200, 200]);
    expect(telemetry.traceExporter.spans.length).toBeGreaterThan(0);
  });

  it('TP-4.21: onDrop("unexpected", n) is never called with n > 0', () => {
    const unexpected = onDrop.mock.calls.filter(([, kind, n]) => kind === "unexpected" && n > 0);

    expect(unexpected).toEqual([]);
  });

  it("TP-4.21: no exported span holds url.full, user_agent.original or x=1", () => {
    const text = JSON.stringify(
      telemetry.traceExporter.spans.map((s) => ({ name: s.name, attributes: s.attributes })),
    );

    expect(text).not.toContain("url.full");
    expect(text).not.toContain("user_agent.original");
    expect(text).not.toContain("x=1");
    expect(text).not.toContain("budmon-test/1.0");
  });

  it("TP-4.21: the query ran inside a traced request (a database span exists)", () => {
    expect(
      telemetry.traceExporter.spans.some(
        (s) => s.attributes["db.system.name"] !== undefined || /^pg\./.test(s.name),
      ),
    ).toBe(true);
  });
});
