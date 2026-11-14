// F-6 registerIdentityMetrics (identity LLD §4.1, LD-7). TP-0.36, plus extra cases TP-0.36x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricData,
} from "@opentelemetry/sdk-metrics";
import { describe, expect, it, vi } from "vitest";
import { createMetrics, type Metrics } from "../../../src/platform/observability/metrics.js";
import { registerIdentityMetrics } from "../../../src/identity/identityMetrics.js";

function meterSetup() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  const onDrop = vi.fn<(n: number) => void>();
  const metrics = createMetrics(provider.getMeter("test"), onDrop);
  const collect = async (): Promise<Map<string, MetricData>> => {
    await reader.forceFlush();
    const byName = new Map<string, MetricData>();
    for (const rm of exporter.getMetrics())
      for (const sm of rm.scopeMetrics)
        for (const m of sm.metrics) byName.set(m.descriptor.name, m);
    return byName;
  };
  return { metrics, onDrop, collect };
}

const TABLE: [string, readonly string[]][] = [
  ["auth_sign_in_total", ["method", "error_key"]],
  ["auth_refresh_total", ["error_key"]],
  ["auth_refresh_reuse_total", []],
  ["auth_two_step_total", ["method", "error_key"]],
  ["identity_emails_total", ["error_key"]],
  ["identity_exports_total", ["error_key"]],
  ["identity_erasures_total", ["error_key"]],
];

describe("TP-0.36: identity's instruments", () => {
  it("TP-0.36: 7 counters with F-6's names and labels", () => {
    const { metrics } = meterSetup();
    const counter = vi.fn(metrics.counter.bind(metrics));
    const spied: Metrics = { ...metrics, counter };

    const m = registerIdentityMetrics(spied);

    expect(counter).toHaveBeenCalledTimes(7);
    const registered = counter.mock.calls.map(([name, opts]) => [name, [...opts.labels].sort()]);
    expect(registered.sort()).toEqual(TABLE.map(([n, l]) => [n, [...l].sort()]).sort());
    for (const [, opts] of counter.mock.calls) expect(opts.description.length).toBeGreaterThan(0);
    expect(Object.keys(m).sort()).toEqual(
      ["signIns", "refreshes", "refreshReuse", "twoStep", "emails", "exports", "erasures"].sort(),
    );
  });

  it("TP-0.36: signIns.add with a userId label drops it and calls onDrop(1)", async () => {
    const { metrics, onDrop, collect } = meterSetup();
    const m = registerIdentityMetrics(metrics);

    m.signIns.add(1, { method: "password", error_key: "none", userId: "x" });

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(1);
    const point = (await collect()).get("auth_sign_in_total")?.dataPoints[0];
    expect(point?.attributes).toEqual({ method: "password", error_key: "none" });
    expect(point?.value).toBe(1);
  });

  it('TP-0.36: a label value "has space" is replaced by "invalid" and calls onDrop(1)', async () => {
    const { metrics, onDrop, collect } = meterSetup();
    const m = registerIdentityMetrics(metrics);

    m.emails.add(1, { error_key: "has space" });

    expect(onDrop).toHaveBeenCalledWith(1);
    expect((await collect()).get("identity_emails_total")?.dataPoints[0]?.attributes).toEqual({
      error_key: "invalid",
    });
  });
});

describe("TP-0.36x: handles map to their metrics", () => {
  it.each([
    ["signIns", "auth_sign_in_total", { method: "google", error_key: "none" }],
    ["refreshes", "auth_refresh_total", { error_key: "REFRESH_INVALID" }],
    ["refreshReuse", "auth_refresh_reuse_total", {}],
    ["twoStep", "auth_two_step_total", { method: "totp", error_key: "none" }],
    ["emails", "identity_emails_total", { error_key: "EMAIL_PERMANENT" }],
    ["exports", "identity_exports_total", { error_key: "none" }],
    ["erasures", "identity_erasures_total", { error_key: "none" }],
  ] as const)("TP-0.36x: %s counts into %s", async (handle, name, labels) => {
    const { metrics, onDrop, collect } = meterSetup();
    const m = registerIdentityMetrics(metrics);

    m[handle].add(2, labels);

    const point = (await collect()).get(name)?.dataPoints[0];
    expect(point?.value).toBe(2);
    expect(point?.attributes).toEqual(labels);
    expect(onDrop).not.toHaveBeenCalled();
  });
});
