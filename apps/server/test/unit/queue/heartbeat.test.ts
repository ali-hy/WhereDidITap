// F-79 startHeartbeat. TP-6.10's unit part (the healthcheck entry is in
// test/integration/main/healthcheck.test.ts), and TP-6.18 (A-515).
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
import {
  defaultHeartbeatFile,
  heartbeatFile,
  startHeartbeat,
} from "../../../src/platform/queue/heartbeat.js";

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
  it("TP-6.10: writes the epoch seconds immediately and on each tick, every 15 s by default, to defaultHeartbeatFile() (A-515)", () => {
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
    expect(h.writeFile).toHaveBeenLastCalledWith(defaultHeartbeatFile(), "1791547200");
    expect(h.setIntervalFake).toHaveBeenCalledWith(expect.any(Function), 15_000);
    h.clock.advance({ seconds: 15 });
    h.tick();
    expect(h.writeFile).toHaveBeenCalledTimes(2);
    expect(h.writeFile).toHaveBeenLastCalledWith(defaultHeartbeatFile(), "1791547215");
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
    // Linux, where A-226's default is /tmp/heartbeat (TP-6.18 covers win32).
    expect(heartbeatFile(env, { platform: "linux" })).toBe(expected);
  });
});

describe("TP-6.18: the heartbeat path on every platform (A-515)", () => {
  const TEMP = "C:\\Users\\u\\AppData\\Local\\Temp";
  const WINDOWS_DEFAULT = "C:\\Users\\u\\AppData\\Local\\Temp\\heartbeat";
  const fakeTmpdir = () => vi.fn(() => TEMP);

  it.each(["linux", "darwin"] as const)(
    "TP-6.18 (a): defaultHeartbeatFile on %s is /tmp/heartbeat without calling tmpdir",
    (platform) => {
      const tmpdir = fakeTmpdir();

      expect(defaultHeartbeatFile({ platform, tmpdir })).toBe("/tmp/heartbeat");
      expect(tmpdir).not.toHaveBeenCalled();
    },
  );

  it("TP-6.18 (b): defaultHeartbeatFile on win32 is <tmpdir>\\heartbeat", () => {
    const tmpdir = fakeTmpdir();

    expect(defaultHeartbeatFile({ platform: "win32", tmpdir })).toBe(WINDOWS_DEFAULT);
  });

  // Rows: [label, expected, env].
  it.each([
    ["/x/hb", "/x/hb", { HEARTBEAT_FILE: "/x/hb" }],
    ["rel/hb", "/tmp/heartbeat", { HEARTBEAT_FILE: "rel/hb" }],
    ["an empty value", "/tmp/heartbeat", { HEARTBEAT_FILE: "" }],
    ["no HEARTBEAT_FILE", "/tmp/heartbeat", {}],
    ["C:\\x\\hb", "/tmp/heartbeat", { HEARTBEAT_FILE: "C:\\x\\hb" }],
  ])("TP-6.18 (c): heartbeatFile on linux with %s gives %s", (_label, expected, env) => {
    expect(heartbeatFile(env, { platform: "linux", tmpdir: fakeTmpdir() })).toBe(expected);
  });

  it.each([
    ["C:\\x\\hb", "C:\\x\\hb", { HEARTBEAT_FILE: "C:\\x\\hb" }],
    ["D:/x/hb", "D:/x/hb", { HEARTBEAT_FILE: "D:/x/hb" }],
    ["\\\\srv\\share\\hb", "\\\\srv\\share\\hb", { HEARTBEAT_FILE: "\\\\srv\\share\\hb" }],
    ["/x/hb", "/x/hb", { HEARTBEAT_FILE: "/x/hb" }],
    ["rel\\hb", WINDOWS_DEFAULT, { HEARTBEAT_FILE: "rel\\hb" }],
    ["C:rel", WINDOWS_DEFAULT, { HEARTBEAT_FILE: "C:rel" }],
    ["an empty value", WINDOWS_DEFAULT, { HEARTBEAT_FILE: "" }],
    ["no HEARTBEAT_FILE", WINDOWS_DEFAULT, {}],
  ])("TP-6.18 (d): heartbeatFile on win32 with %s gives %s", (_label, expected, env) => {
    expect(heartbeatFile(env, { platform: "win32", tmpdir: fakeTmpdir() })).toBe(expected);
  });

  it("TP-6.18 (e): startHeartbeat without path writes to defaultHeartbeatFile()", () => {
    const h = harness();

    const heartbeat = startHeartbeat({
      metrics: h.metrics,
      logger: h.logger,
      clock: h.clock,
      service: "worker-general",
      setInterval: h.setIntervalFake,
      writeFile: h.writeFile,
    });

    expect(h.writeFile.mock.calls[0]?.[0]).toBe(defaultHeartbeatFile());
    heartbeat.stop();
  });
});
