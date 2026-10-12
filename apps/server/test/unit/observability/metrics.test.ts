// F-41 createMetrics and F-42 registerPlatformMetrics. TP-3.8, plus extra cases TP-3.27x (names,
// METRIC_LABELS, histograms and gauges) and TP-3.28x (F-42 registers its set without throwing).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricData,
} from "@opentelemetry/sdk-metrics";
import { describe, expect, it, vi } from "vitest";
import {
  METRIC_LABELS,
  createMetrics,
  registerPlatformMetrics,
} from "../../../src/platform/observability/metrics.js";

function setup() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  const onDrop = vi.fn<(n: number) => void>();
  const metrics = createMetrics(provider.getMeter("test"), onDrop);
  /** Every metric exported so far, by name. */
  const collect = async (): Promise<Map<string, MetricData>> => {
    await reader.forceFlush();
    const byName = new Map<string, MetricData>();
    for (const rm of exporter.getMetrics()) {
      for (const sm of rm.scopeMetrics)
        for (const m of sm.metrics) byName.set(m.descriptor.name, m);
    }
    return byName;
  };
  return { metrics, onDrop, collect, provider };
}

describe("TP-3.8: createMetrics", () => {
  it("TP-3.8: registering an instrument with label user_id throws", () => {
    const { metrics } = setup();

    expect(() =>
      metrics.counter("entries_total", { description: "d", labels: ["user_id"] }),
    ).toThrow(new Error("metric definition invalid: entries_total"));
  });

  it('TP-3.8: an undeclared label foo is removed and a value "a b" becomes "invalid"; onDrop twice', async () => {
    const { metrics, onDrop, collect } = setup();
    const counter = metrics.counter("jobs_seen_total", { description: "d", labels: ["queue"] });

    counter.add(1, { queue: "a b", foo: "x" });

    const metric = (await collect()).get("jobs_seen_total");
    expect(metric?.dataPoints.map((p) => p.attributes)).toEqual([{ queue: "invalid" }]);
    expect(metric?.dataPoints.map((p) => p.value)).toEqual([1]);
    expect(onDrop).toHaveBeenCalledTimes(2);
    expect(onDrop).toHaveBeenNthCalledWith(1, 1);
    expect(onDrop).toHaveBeenNthCalledWith(2, 1);
  });
});

describe("TP-3.8: a label listed twice (A-138)", () => {
  it('TP-3.8: labels ["method", "method"] throw', () => {
    const { metrics } = setup();

    expect(() =>
      metrics.counter("dup_labels_total", { description: "d", labels: ["method", "method"] }),
    ).toThrow(new Error("metric definition invalid: dup_labels_total"));
  });
});

describe("TP-3.27x: createMetrics, further cases (F-41)", () => {
  it("TP-3.27x: METRIC_LABELS is F-41's set", () => {
    expect([...METRIC_LABELS].sort()).toEqual(
      [
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
        "reason", // A-178
      ].sort(),
    );
  });

  it.each([
    ["two characters", "ab"],
    ["an upper-case letter", "Jobs_total"],
    ["a leading digit", "1jobs"],
    ["a dot", "jobs.total"],
    ["65 characters", `a${"b".repeat(64)}`],
  ])("TP-3.27x: a name with %s throws", (_label, name) => {
    const { metrics } = setup();

    expect(() => metrics.counter(name, { description: "d", labels: [] })).toThrow(
      new Error(`metric definition invalid: ${name}`),
    );
  });

  it.each([
    ["three characters", "abc"],
    ["64 characters", `a${"b".repeat(63)}`],
  ])("TP-3.27x: a name with %s is accepted", (_label, name) => {
    const { metrics } = setup();

    expect(() => metrics.counter(name, { description: "d", labels: [] })).not.toThrow();
  });

  it("TP-3.27x: histogram and observableGauge registration checks labels too", () => {
    const { metrics } = setup();

    expect(() =>
      metrics.histogram("duration_seconds", {
        description: "d",
        labels: ["email"],
        buckets: [0.1, 1, 5, 30, 120, 600],
      }),
    ).toThrow(new Error("metric definition invalid: duration_seconds"));
    expect(() => {
      metrics.observableGauge("depth_now", { description: "d", labels: ["payee"] }, () => []);
    }).toThrow(new Error("metric definition invalid: depth_now"));
  });

  it("TP-3.27x: a histogram records with its declared labels and drops the rest", async () => {
    const { metrics, onDrop, collect } = setup();
    const histogram = metrics.histogram("work_seconds", {
      description: "d",
      labels: ["queue"],
      buckets: [0.1, 1, 5, 30, 120, 600],
    });

    histogram.record(2, { queue: "fx", extra: "y" });

    const metric = (await collect()).get("work_seconds");
    expect(metric?.dataPointType).toBe(DataPointType.HISTOGRAM);
    expect(metric?.dataPoints.map((p) => p.attributes)).toEqual([{ queue: "fx" }]);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("TP-3.27x: valid labels are recorded as given, with no drops", async () => {
    const { metrics, onDrop, collect } = setup();
    const counter = metrics.counter("requests_seen_total", {
      description: "d",
      labels: ["method", "status_class"],
    });

    counter.add(3, { method: "GET", status_class: "2xx" });

    const metric = (await collect()).get("requests_seen_total");
    expect(metric?.dataPoints.map((p) => [p.attributes, p.value])).toEqual([
      [{ method: "GET", status_class: "2xx" }, 3],
    ]);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("TP-3.27x: an observable gauge reports what its callback observes", async () => {
    const { metrics, collect } = setup();

    metrics.observableGauge("queue_depth_now", { description: "d", labels: ["queue"] }, () => [
      { value: 7, labels: { queue: "fx" } },
    ]);

    const metric = (await collect()).get("queue_depth_now");
    expect(metric?.dataPoints.map((p) => [p.attributes, p.value])).toEqual([[{ queue: "fx" }, 7]]);
  });
});

describe("TP-3.28x: registerPlatformMetrics (F-42)", () => {
  it("TP-3.28x: registers the platform set with createMetrics without throwing", () => {
    const { metrics } = setup();

    expect(() => registerPlatformMetrics(metrics)).not.toThrow();
  });
});
