// F-79 startHeartbeat. TP-6.10's unit part (the healthcheck entry is in
// test/integration/main/healthcheck.test.ts).
import { fixedClock } from "@budmon/shared";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../src/platform/observability/logger.js";
import {
  createMetrics,
  registerPlatformMetrics,
} from "../../../src/platform/observability/metrics.js";
import { logCapture } from "../../support/telemetry.js";
import { heartbeatFile, startHeartbeat } from "../../../src/platform/queue/heartbeat.js";

function harness() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  // A-206: F-79 observes PlatformMetrics' worker_heartbeat_timestamp_seconds.
  const metrics = registerPlatformMetrics(
    createMetrics(provider.getMeter("test"), () => undefined),
  );
  const capture = logCapture();
  const logger = createLogger({
    service: "worker-general",
    release: "dev",
    level: "debug",
    destination: capture,
  });
  let tick: (() => void) | undefined;
  const setIntervalFake = vi.fn((fn: () => void, ms: number) => {
    tick = fn;
    return ms;
  });
  const writeFile = vi.fn<(path: string, data: string) => void>();
  const clock = fixedClock("2026-10-09T12:00:00.750Z");
  const gauge = async (): Promise<{ value: unknown; attributes: Record<string, unknown> }[]> => {
    await reader.forceFlush();
    const points: { value: unknown; attributes: Record<string, unknown> }[] = [];
    for (const rm of exporter.getMetrics()) {
      for (const sm of rm.scopeMetrics) {
        for (const m of sm.metrics) {
          if (m.descriptor.name !== "worker_heartbeat_timestamp_seconds") continue;
          for (const p of m.dataPoints) points.push({ value: p.value, attributes: p.attributes });
        }
      }
    }
    return points;
  };
  return {
    metrics,
    logger,
    capture,
    clock,
    setIntervalFake,
    writeFile,
    tick: () => {
      tick?.();
    },
    gauge,
  };
}

describe("TP-6.10: startHeartbeat (F-79)", () => {
  it("TP-6.10: writes the epoch seconds immediately and on each tick, every 15 s by default, to /tmp/heartbeat", () => {
    const h = harness();

    const heartbeat = startHeartbeat({
      metrics: h.metrics,
      logger: h.logger,
      clock: h.clock,
      service: "worker-general",
      setInterval: h.setIntervalFake,
      writeFile: h.writeFile,
    });

    expect(h.writeFile).toHaveBeenCalledTimes(1);
    expect(h.writeFile).toHaveBeenLastCalledWith("/tmp/heartbeat", "1791547200");
    expect(h.setIntervalFake).toHaveBeenCalledWith(expect.any(Function), 15_000);
    h.clock.advance({ seconds: 15 });
    h.tick();
    expect(h.writeFile).toHaveBeenCalledTimes(2);
    expect(h.writeFile).toHaveBeenLastCalledWith("/tmp/heartbeat", "1791547215");
    expect(heartbeat.last()).toBe(1791547215.75);
    heartbeat.stop();
  });

  it("TP-6.10: the gauge worker_heartbeat_timestamp_seconds{service} is the last beat", async () => {
    const h = harness();

    const heartbeat = startHeartbeat({
      metrics: h.metrics,
      logger: h.logger,
      clock: h.clock,
      service: "worker-general",
      setInterval: h.setIntervalFake,
      writeFile: h.writeFile,
    });

    expect(await h.gauge()).toEqual([
      { value: heartbeat.last(), attributes: { service: "worker-general" } },
    ]);
    heartbeat.stop();
  });

  it("TP-6.10: a write that throws once logs one heartbeat_write_failed through the passed logger (A-206), and the timer continues", () => {
    const h = harness();
    h.writeFile.mockImplementationOnce(() => {
      throw new Error("EROFS");
    });

    const heartbeat = startHeartbeat({
      metrics: h.metrics,
      logger: h.logger,
      clock: h.clock,
      service: "worker-general",
      setInterval: h.setIntervalFake,
      writeFile: h.writeFile,
    });
    h.clock.advance({ seconds: 15 });
    h.tick();

    expect(h.writeFile).toHaveBeenCalledTimes(2);
    expect(heartbeat.last()).toBe(1791547215.75);
    // A-206: through the logger passed in.
    expect(h.capture.records().filter((l) => l["event"] === "heartbeat_write_failed")).toHaveLength(
      1,
    );
    heartbeat.stop();
  });

  it("TP-6.10: intervalMs and path are used when given", () => {
    const h = harness();

    const heartbeat = startHeartbeat({
      metrics: h.metrics,
      logger: h.logger,
      clock: h.clock,
      service: "worker-capture",
      intervalMs: 1000,
      path: "/tmp/other-heartbeat",
      setInterval: h.setIntervalFake,
      writeFile: h.writeFile,
    });

    expect(h.setIntervalFake).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(h.writeFile).toHaveBeenLastCalledWith("/tmp/other-heartbeat", "1791547200");
    heartbeat.stop();
  });
});

describe("TP-6.10: heartbeatFile (A-226)", () => {
  it.each([
    ["an absolute HEARTBEAT_FILE", { HEARTBEAT_FILE: "/var/tmp/hb-test" }, "/var/tmp/hb-test"],
    ["the relative rel/hb", { HEARTBEAT_FILE: "rel/hb" }, "/tmp/heartbeat"],
    ["an empty HEARTBEAT_FILE", { HEARTBEAT_FILE: "" }, "/tmp/heartbeat"],
    ["no HEARTBEAT_FILE", {}, "/tmp/heartbeat"],
  ])("TP-6.10: %s gives %s", (_label, env: Record<string, string>, expected) => {
    expect(heartbeatFile(env)).toBe(expected);
  });
});
