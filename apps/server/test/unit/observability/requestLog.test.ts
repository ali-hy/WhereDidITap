// F-38 registerRequestLog through a structural fake host, with F-41/F-42's metrics (A-105, A-111,
// code review B-4). TP-3.15, plus extra cases TP-3.32x. TP-4.17 repeats the check through the real
// server in S-4. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// The fake request carries the fields of the exported RequestLogRequest type (A-105: method,
// routeOptions.url, orpcRoute and the request context).
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricData,
} from "@opentelemetry/sdk-metrics";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../src/platform/observability/logger.js";
import {
  createMetrics,
  registerPlatformMetrics,
} from "../../../src/platform/observability/metrics.js";
import { registerRequestLog } from "../../../src/platform/observability/requestLog.js";
import { logCapture } from "../../support/telemetry.js";

type Host = Parameters<typeof registerRequestLog>[0];
type Hook = Parameters<Host["addHook"]>[1];
type Request = Parameters<Hook>[0];

function setup() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  const onDrop = vi.fn<(n: number) => void>();
  const metrics = registerPlatformMetrics(createMetrics(provider.getMeter("test"), onDrop));
  const capture = logCapture();
  const logger = createLogger({
    service: "api",
    release: "v1.2.3",
    level: "debug",
    destination: capture,
  });
  const hooks: { name: string; hook: Hook }[] = [];
  const host: Host = {
    addHook: (name, hook) => {
      hooks.push({ name, hook });
      return host;
    },
  };
  registerRequestLog(host, { logger, metrics });
  const respond = async (request: Partial<Request>, statusCode: number, elapsedTime: number) => {
    for (const { hook } of hooks) {
      await hook({ method: "GET", url: "/", ...request }, { statusCode, elapsedTime });
    }
  };
  const collect = async (): Promise<Map<string, MetricData>> => {
    await reader.forceFlush();
    const byName = new Map<string, MetricData>();
    for (const rm of exporter.getMetrics()) {
      for (const sm of rm.scopeMetrics)
        for (const m of sm.metrics) byName.set(m.descriptor.name, m);
    }
    return byName;
  };
  return { hooks, respond, capture, onDrop, collect };
}

const ORPC = {
  method: "GET",
  url: "/meta/client-config",
  orpcRoute: "/meta/client-config",
  routeOptions: { url: "/*" },
  clientKind: "web",
  clientVersion: 7,
  requestId: "req-1",
  userId: "0190a0b0-0000-7000-8000-000000000001",
} as Partial<Request>;

const FASTIFY = {
  method: "GET",
  url: "/api/v1/auth/google/callback?code=abc",
  routeOptions: { url: "/api/v1/auth/google/callback" },
  requestId: "req-2",
} as Partial<Request>;

const UNMATCHED = { method: "POST", url: "/nope?x=1", requestId: "req-3" } as Partial<Request>;

describe("TP-3.15: registerRequestLog", () => {
  it("TP-3.15: registers one onResponse hook", () => {
    const { hooks } = setup();

    expect(hooks.map((h) => h.name)).toEqual(["onResponse"]);
  });

  it("TP-3.15: an oRPC route logs one http_request line with every field, at info", async () => {
    const { respond, capture } = setup();

    await respond(ORPC, 200, 12);

    expect(capture.records()).toHaveLength(1);
    expect(capture.records()[0]).toMatchObject({
      level: "info",
      event: "http_request",
      method: "GET",
      route: "/meta/client-config",
      status: 200,
      statusClass: "2xx",
      durationMs: 12,
      clientKind: "web",
      clientVersion: 7,
      requestId: "req-1",
      userId: "0190a0b0-0000-7000-8000-000000000001",
    });
  });

  it("TP-3.15: a Fastify route logs its routeOptions.url template, without a userId", async () => {
    const { respond, capture } = setup();

    await respond(FASTIFY, 302, 5);

    const [line] = capture.records();
    expect(line).toMatchObject({
      level: "info",
      route: "/api/v1/auth/google/callback",
      status: 302,
      statusClass: "3xx",
      requestId: "req-2",
    });
    expect(line).not.toHaveProperty("userId");
  });

  it("TP-3.15: a request with no matched route logs route /unmatched", async () => {
    const { respond, capture } = setup();

    await respond(UNMATCHED, 404, 1);

    expect(capture.records()[0]).toMatchObject({ level: "info", route: "/unmatched", status: 404 });
  });

  it.each([["/health/live"], ["/health/ready"]])("TP-3.15: %s logs at debug", async (route) => {
    const { respond, capture } = setup();

    await respond({ method: "GET", url: route, routeOptions: { url: route } }, 200, 1);

    expect(capture.records()[0]).toMatchObject({ level: "debug", event: "http_request", route });
  });

  it("TP-3.15: both metrics record http_route as the template, with method and status_class", async () => {
    const { respond, collect } = setup();

    await respond(ORPC, 200, 12);
    await respond(FASTIFY, 302, 5);
    await respond(UNMATCHED, 404, 1);

    const metrics = await collect();
    const requests = metrics.get("http_server_requests_total");
    const durations = metrics.get("http_server_duration_seconds");
    const routes = (m: MetricData | undefined) =>
      (m?.dataPoints ?? []).map((p) => p.attributes["http_route"]).sort();
    expect(routes(requests)).toEqual(
      ["/api/v1/auth/google/callback", "/meta/client-config", "/unmatched"].sort(),
    );
    expect(routes(durations)).toEqual(
      ["/api/v1/auth/google/callback", "/meta/client-config", "/unmatched"].sort(),
    );
    expect(
      requests?.dataPoints.find((p) => p.attributes["http_route"] === "/meta/client-config")
        ?.attributes,
    ).toMatchObject({
      method: "GET",
      status_class: "2xx",
    });
    expect(
      requests?.dataPoints.find((p) => p.attributes["http_route"] === "/unmatched")?.attributes,
    ).toMatchObject({
      method: "POST",
      status_class: "4xx",
    });
  });

  it("TP-3.15: onDrop is never called", async () => {
    const { respond, collect, onDrop } = setup();

    await respond(ORPC, 200, 12);
    await respond(FASTIFY, 302, 5);
    await respond(UNMATCHED, 404, 1);
    await respond(
      { method: "GET", url: "/health/ready", routeOptions: { url: "/health/ready" } },
      200,
      1,
    );
    await collect();

    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe("TP-3.32x: registerRequestLog, further cases (F-38)", () => {
  it("TP-3.32x: the duration histogram records seconds", async () => {
    const { respond, collect } = setup();

    await respond(ORPC, 200, 1500);

    const point = (await collect()).get("http_server_duration_seconds")?.dataPoints[0];
    expect((point?.value as { sum?: number } | undefined)?.sum).toBe(1.5);
  });

  it("TP-3.32x: the URL's query never reaches the log line", async () => {
    const { respond, capture } = setup();

    await respond(FASTIFY, 302, 5);

    expect(capture.text()).not.toContain("code=abc");
  });
});
