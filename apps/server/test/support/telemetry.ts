// Test helpers for S-3's observability layers (LLD §10.1): `logCapture()` (a pino destination
// collecting lines) and `inMemoryTelemetry()` (a span exporter and a metric reader that keep what
// they receive). Owned by the test-architect.
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

export interface LogCapture {
  /** A pino `DestinationStream`: pino writes each JSON line through `write`. */
  write(chunk: string): void;
  /** Every complete line written so far. */
  lines(): string[];
  /** Every line parsed as JSON. */
  records(): Record<string, unknown>[];
  /** Everything written, as one string. */
  text(): string;
}

export function logCapture(): LogCapture {
  let buffer = "";
  return {
    write(chunk: string): void {
      buffer += chunk;
    },
    lines(): string[] {
      return buffer.split("\n").filter((line) => line !== "");
    },
    records(): Record<string, unknown>[] {
      return this.lines().map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    text(): string {
      return buffer;
    },
  };
}

/**
 * A span exporter that keeps every span it's given, also after `shutdown` (the SDK's
 * InMemorySpanExporter clears its spans on shutdown, which happens before the tests can read them).
 */
export class RecordingSpanExporter implements SpanExporter {
  readonly spans: ReadableSpan[] = [];
  shutdowns = 0;

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.spans.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    this.shutdowns += 1;
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export interface InMemoryTelemetry {
  traceExporter: RecordingSpanExporter;
  metricExporter: InMemoryMetricExporter;
  /** Exports only when flushed or shut down (the interval is far longer than any test). */
  metricReader: PeriodicExportingMetricReader;
  /** Every exported ResourceMetrics, as plain JSON text, for canary scans. */
  metricsText(): string;
  resourceMetrics(): ResourceMetrics[];
}

export function inMemoryTelemetry(): InMemoryTelemetry {
  const traceExporter = new RecordingSpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 3_600_000,
    exportTimeoutMillis: 30_000,
  });
  return {
    traceExporter,
    metricExporter,
    metricReader,
    resourceMetrics: () => metricExporter.getMetrics(),
    metricsText: () => JSON.stringify(metricExporter.getMetrics()),
  };
}
