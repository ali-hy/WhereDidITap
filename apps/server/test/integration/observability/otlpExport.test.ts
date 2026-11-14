// F-36 with an OTLP endpoint and headers (A-138). TP-3.11's A-138 part: exports go to
// <endpoint>/v1/traces and <endpoint>/v1/metrics with the configured Authorization header, against a
// fake OTLP HTTP server. (The endpoint is http://localhost, which F-10 allows in development and
// test; https://otlp.example can't be served locally.)
import { createServer, type Server } from "node:http";
import { trace } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Secret } from "../../../src/platform/observability/redaction.js";

interface Received {
  path: string;
  authorization: string | undefined;
}

let server: Server;
const received: Received[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    received.push({ path: req.url ?? "", authorization: req.headers.authorization });
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  const { startTelemetry } = await import("../../../src/platform/observability/otel.js");
  const started = startTelemetry(
    {
      endpoint: new URL(`http://localhost:${String(port)}/otlp`),
      headers: Secret.of({ Authorization: "Basic x" }),
      service: "api",
      release: "v1.2.3",
      environment: "test",
    },
    { onDrop: () => undefined },
  );
  trace.getTracer("tp-3.11").startSpan("tp-3.11").end();
  started.metrics
    .counter("tp_three_eleven_otlp_total", { description: "d", labels: [] })
    .add(1, {});
  await started.shutdown();
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe("TP-3.11: OTLP export with an endpoint and headers (A-138)", () => {
  it("TP-3.11: traces go to /otlp/v1/traces with the Authorization header", () => {
    expect(
      received.filter((r) => r.path === "/otlp/v1/traces").map((r) => r.authorization),
    ).toContain("Basic x");
  });

  it("TP-3.11: metrics go to /otlp/v1/metrics with the Authorization header", () => {
    expect(
      received.filter((r) => r.path === "/otlp/v1/metrics").map((r) => r.authorization),
    ).toContain("Basic x");
  });

  it("TP-3.11: every export carries the header, and nothing goes elsewhere", () => {
    expect(received.length).toBeGreaterThan(0);
    for (const r of received) {
      expect(["/otlp/v1/traces", "/otlp/v1/metrics"]).toContain(r.path);
      expect(r.authorization).toBe("Basic x");
    }
  });
});
