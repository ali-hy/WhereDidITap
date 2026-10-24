// F-36 startTelemetry with real instrumentations. TP-3.11, plus extra cases TP-3.29x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// One telemetry instance per file (the SDK registers global providers): `beforeAll` starts it,
// drives every request, and shuts it down so everything is exported; the cases then assert on what
// the in-memory exporter and reader received.
//
// "No network export attempted" (a): OTEL_EXPORTER_OTLP_ENDPOINT points at a local sentinel server
// while startTelemetry has no `endpoint`; the sentinel must receive nothing.
import { createRequire } from "node:module";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { SpanKind } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inMemoryTelemetry, type InMemoryTelemetry } from "../../support/telemetry.js";

const require = createRequire(import.meta.url);

/** F-36's METRIC_ATTRIBUTE_ALLOWLIST: F-41's METRIC_LABELS plus the instrumentation attributes. */
const METRIC_ATTRIBUTE_ALLOWLIST = new Set([
  "service",
  "environment",
  "http_route",
  "method",
  "status_class",
  "client_kind",
  "queue",
  "job_state",
  "module",
  "error_key",
  "source_kind",
  "connection_status",
  "age_bucket",
  "signal",
  "drop_kind",
  "limiter",
  "provider",
  "reason",
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "url.scheme",
  "server.address",
  "server.port",
  "network.protocol.version",
  "db.system.name",
  "db.namespace",
  "db.operation.name",
  "error.type",
]);

interface Listening {
  server: Server;
  port: number;
  requests: string[];
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  },
): Promise<Listening> {
  // Loaded through require after startTelemetry, so the http instrumentation's hook applies.
  const http = require("node:http") as typeof import("node:http");
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? "");
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { server, port, requests };
}

async function close(l: Listening): Promise<void> {
  await new Promise<void>((resolve) => {
    l.server.close(() => {
      resolve();
    });
  });
}

const CANARY_HOST = `${CANARIES.payee}.example.invalid:9876`;

/** Writes `text` to 127.0.0.1:port and resolves once the server closes the connection. */
async function rawRequest(port: number, text: string): Promise<string> {
  const net = await import("node:net");
  return new Promise<string>((resolve, reject) => {
    let received = "";
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(text);
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (received += chunk));
    socket.on("end", () => {
      resolve(received);
    });
    socket.on("error", reject);
  });
}

let telemetry: InMemoryTelemetry;
let sentinel: Listening;
const drops: { signal: string; kind: string; n: number }[] = [];
let metricWorked = false;

beforeAll(async () => {
  sentinel = await listen((_req, res) => {
    res.writeHead(200);
    res.end();
  });
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", `http://127.0.0.1:${String(sentinel.port)}`);
  telemetry = inMemoryTelemetry();
  const { startTelemetry } = await import("../../../src/platform/observability/otel.js");
  const started = startTelemetry(
    { service: "api", release: "v1.2.3", environment: "test" },
    {
      onDrop: (signal: string, kind: string, n: number) => drops.push({ signal, kind, n }),
      traceExporter: telemetry.traceExporter,
      metricReader: telemetry.metricReader,
    },
  );

  // (a) instruments work without an endpoint.
  const counter = started.metrics.counter("tp_three_eleven_total", {
    description: "TP-3.11 (a)",
    labels: ["queue"],
  });
  counter.add(1, { queue: "fx" });
  metricWorked = true;

  // (b) incoming requests: one ignored health route, one ordinary route.
  const app = await listen();
  await (await fetch(`http://127.0.0.1:${String(app.port)}/health/ready`)).text();
  await (await fetch(`http://127.0.0.1:${String(app.port)}/x`)).text();

  // (c) an outgoing client request whose URL carries a canary in its query.
  await (await fetch(`http://localhost:${String(app.port)}/a?token=${CANARIES.token}`)).text();

  // (A-177) an incoming request whose Host is a canary, sent over a raw socket so no client
  // instrumentation sees it.
  await rawRequest(
    app.port,
    `GET /y HTTP/1.1\r\nHost: ${CANARY_HOST}\r\nConnection: close\r\n\r\n`,
  );

  await close(app);
  await started.shutdown();
  vi.unstubAllEnvs();
}, 120_000);

afterAll(async () => {
  await close(sentinel);
});

function serverSpans(): ReadableSpan[] {
  return telemetry.traceExporter.spans.filter((s) => s.kind === SpanKind.SERVER);
}

describe("TP-3.11: startTelemetry", () => {
  it("TP-3.11 (a): without an endpoint, a metric records and nothing is exported over the network", () => {
    expect(metricWorked).toBe(true);
    const names = telemetry
      .resourceMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics.map((m) => m.descriptor.name)));
    expect(names).toContain("tp_three_eleven_total");
    expect(sentinel.requests).toEqual([]);
  });

  it("TP-3.11 (b): no span for /health/ready, one server span for /x", () => {
    const spans = serverSpans();
    const text = JSON.stringify(spans.map((s) => ({ name: s.name, attributes: s.attributes })));

    expect(text).not.toContain("/health");
    // Four requests reached the server: /health/ready (ignored), /x, /a (c) and /y (A-177).
    expect(spans).toHaveLength(3);
  });

  it("TP-3.11 (c): client-duration metric points carry only allowlisted attributes, never url.full or the canary", () => {
    const metrics = telemetry
      .resourceMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics));
    const clientDurations = metrics.filter((m) => /client.*duration/.test(m.descriptor.name));

    expect(clientDurations.length).toBeGreaterThan(0);
    for (const metric of metrics) {
      for (const point of metric.dataPoints) {
        for (const key of Object.keys(point.attributes)) {
          expect(METRIC_ATTRIBUTE_ALLOWLIST, `${metric.descriptor.name}: ${key}`).toContain(key);
        }
      }
    }
    expect(telemetry.metricsText()).not.toContain("url.full");
    expect(scanForCanaries([{ name: "metrics", text: telemetry.metricsText() }], CANARIES)).toEqual(
      [],
    );
  });
});

describe("TP-3.11: http.server.* metrics carry no client host (A-177, A-181)", () => {
  it("TP-3.11: http.server.request.duration has no server.address or server.port, and no canary", () => {
    const metrics = telemetry
      .resourceMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics));
    const serverDurations = metrics.filter(
      (m) => m.descriptor.name === "http.server.request.duration",
    );

    // A-181: no View; the pinned instrumentation must not add the client's Host.
    expect(serverDurations.length).toBeGreaterThan(0);
    for (const metric of serverDurations) {
      expect(metric.dataPoints.length).toBeGreaterThan(0);
      for (const point of metric.dataPoints) {
        expect(Object.keys(point.attributes)).not.toContain("server.address");
        expect(Object.keys(point.attributes)).not.toContain("server.port");
      }
    }
    const text = JSON.stringify(serverDurations.map((m) => m.dataPoints));
    expect(scanForCanaries([{ name: "server metrics", text }], CANARIES)).toEqual([]);
  });

  it("TP-3.11: no exported span carries the canary Host", () => {
    const text = JSON.stringify(
      telemetry.traceExporter.spans.map((s) => ({ name: s.name, attributes: s.attributes })),
    );

    expect(scanForCanaries([{ name: "spans", text }], CANARIES)).toEqual([]);
  });
});

describe("TP-3.29x: startTelemetry, further cases (F-36, F-40)", () => {
  it("TP-3.29x: no exported span carries the canary or a url.full attribute", () => {
    const text = JSON.stringify(
      telemetry.traceExporter.spans.map((s) => ({
        name: s.name,
        attributes: s.attributes,
        events: s.events,
        status: s.status,
      })),
    );

    expect(text).not.toContain("url.full");
    expect(scanForCanaries([{ name: "spans", text }], CANARIES)).toEqual([]);
  });

  it("TP-3.29x: the resource names the service, version and environment", () => {
    const resource = telemetry.traceExporter.spans[0]?.resource.attributes;

    expect(resource).toMatchObject({
      "service.name": "api",
      "service.version": "v1.2.3",
      "deployment.environment.name": "test",
    });
  });

  // Whether plain http and fetch produce no unexpected drops is TP-4.21's question (S-4).
  it("TP-3.29x: the span exporter's drops reach onDrop with signal traces", () => {
    const traces = drops.filter((d) => d.signal === "traces");

    expect(traces.some((d) => d.kind === "expected" && d.n > 0)).toBe(true);
  });
});
