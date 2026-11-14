// F-41 createMetrics and F-42 registerPlatformMetrics: instruments with a closed set of labels.
import type { Meter } from "@opentelemetry/api";
import { isRoute, TOKEN } from "./safeFields.js";

export const METRIC_LABELS: ReadonlySet<string> = new Set([
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
  // A-178: http_client_errors_total.
  "reason",
]);

const NAME = /^[a-z][a-z0-9_]{2,63}$/;

type Labels = Record<string, string>;
type Buckets = readonly [number, number, number, number, number, number];

export interface Metrics {
  counter(
    name: string,
    opts: { description: string; labels: readonly string[] },
  ): { add(n: number, labels: Labels): void };
  histogram(
    name: string,
    opts: { description: string; labels: readonly string[]; buckets: Buckets },
  ): { record(v: number, labels: Labels): void };
  observableGauge(
    name: string,
    opts: { description: string; labels: readonly string[] },
    observe: () => readonly { value: number; labels: Labels }[],
  ): void;
}

export function createMetrics(meter: Meter, onDrop: (n: number) => void): Metrics {
  const define = (name: string, labels: readonly string[]): ((given: Labels) => Labels) => {
    if (
      !NAME.test(name) ||
      labels.some((label) => !METRIC_LABELS.has(label)) ||
      // A-138: a label listed twice.
      new Set(labels).size !== labels.length
    ) {
      throw new Error(`metric definition invalid: ${name}`);
    }
    const declared = new Set(labels);
    return (given) => {
      const clean: Labels = {};
      for (const [key, value] of Object.entries(given)) {
        if (!declared.has(key)) {
          onDrop(1);
          continue;
        }
        // http_route holds a route template; every other label a token (A-111).
        if (key === "http_route" ? isRoute(value) : TOKEN.test(value)) {
          clean[key] = value;
        } else {
          clean[key] = "invalid";
          onDrop(1);
        }
      }
      return clean;
    };
  };
  return {
    counter(name, opts) {
      const clean = define(name, opts.labels);
      const counter = meter.createCounter(name, { description: opts.description });
      return {
        add: (n, labels) => {
          counter.add(n, clean(labels));
        },
      };
    },
    histogram(name, opts) {
      const clean = define(name, opts.labels);
      const histogram = meter.createHistogram(name, {
        description: opts.description,
        advice: { explicitBucketBoundaries: [...opts.buckets] },
      });
      return {
        record: (v, labels) => {
          histogram.record(v, clean(labels));
        },
      };
    },
    observableGauge(name, opts, observe) {
      const clean = define(name, opts.labels);
      const gauge = meter.createObservableGauge(name, { description: opts.description });
      gauge.addCallback((result) => {
        for (const { value, labels } of observe()) result.observe(value, clean(labels));
      });
    },
  };
}

type Counter = ReturnType<Metrics["counter"]>;
type Histogram = ReturnType<Metrics["histogram"]>;
type Observe = () => readonly { value: number; labels: Labels }[];

export interface PlatformMetrics {
  httpServerRequests: Counter;
  httpServerDuration: Histogram;
  jobsProcessed: Counter;
  jobDuration: Histogram;
  jobsDeadLettered: Counter;
  telemetryAttributesDropped: Counter;
  /** A-178: connection-level errors answered by clientErrorHandler. */
  httpClientErrors: Counter;
  rateLimited: Counter;
  idempotentReplays: Counter;
  clientUpdateRequired: Counter;
  kmsErrors: Counter;
  fxRatesFetched: Counter;
  fxRatesRejected: Counter;
  fxBackfillMissing: Counter;
  reconcileCorrections: Counter;
  /** Observable gauges: each takes the callback that reads the current values. */
  observeQueueDepth(observe: Observe): void;
  observeWorkerHeartbeat(observe: Observe): void;
  observeFxLastDay(observe: Observe): void;
}

export function registerPlatformMetrics(m: Metrics): PlatformMetrics {
  const counter = (name: string, description: string, labels: readonly string[]): Counter =>
    m.counter(name, { description, labels });
  const gauge =
    (name: string, description: string, labels: readonly string[]) =>
    (observe: Observe): void => {
      m.observableGauge(name, { description, labels }, observe);
    };
  return {
    httpServerRequests: counter("http_server_requests_total", "HTTP requests served", [
      "http_route",
      "method",
      "status_class",
      "client_kind",
    ]),
    httpServerDuration: m.histogram("http_server_duration_seconds", {
      description: "HTTP request duration",
      labels: ["http_route", "method"],
      buckets: [0.05, 0.1, 0.3, 0.8, 2, 5],
    }),
    jobsProcessed: counter("jobs_processed_total", "Jobs processed", ["queue", "job_state"]),
    jobDuration: m.histogram("job_duration_seconds", {
      description: "Job duration",
      labels: ["queue"],
      buckets: [0.1, 1, 5, 30, 120, 600],
    }),
    jobsDeadLettered: counter("jobs_dead_lettered_total", "Jobs moved to a dead-letter queue", [
      "queue",
    ]),
    telemetryAttributesDropped: counter(
      "telemetry_attributes_dropped_total",
      "Telemetry attributes, fields and labels dropped",
      ["signal", "drop_kind"],
    ),
    httpClientErrors: counter(
      "http_client_errors_total",
      "Connection-level client errors answered before a request existed",
      ["reason"],
    ),
    rateLimited: counter("rate_limited_total", "Requests refused by a rate limiter", ["limiter"]),
    idempotentReplays: counter("idempotent_replays_total", "Creates answered from a record", []),
    clientUpdateRequired: counter(
      "client_update_required_total",
      "Requests from clients below the minimum version",
      ["client_kind"],
    ),
    kmsErrors: counter("kms_errors_total", "KMS calls that failed", []),
    fxRatesFetched: counter("fx_rates_fetched_total", "FX rates fetched", ["provider"]),
    fxRatesRejected: counter("fx_rates_rejected_total", "FX rates rejected", ["provider"]),
    fxBackfillMissing: counter("fx_backfill_missing_total", "FX backfills that found no rate", []),
    reconcileCorrections: counter("reconcile_corrections_total", "Reconciliation corrections", [
      "module",
    ]),
    observeQueueDepth: gauge("queue_depth", "Jobs waiting per queue", ["queue"]),
    observeWorkerHeartbeat: gauge("worker_heartbeat_timestamp_seconds", "Last worker heartbeat", [
      "service",
    ]),
    observeFxLastDay: gauge("fx_last_day_timestamp_seconds", "Latest day with FX rates", []),
  };
}
