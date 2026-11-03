// F-89's handle store (A-147): where the `--import` preload leaves the running telemetry, and
// how the entries read it. Side-effect free, so importing it never starts anything.
import { createNoopMeter } from "@opentelemetry/api";
import { createMetrics, type Metrics } from "./metrics.js";

export interface TelemetryHandle {
  metrics: Metrics;
  shutdown(): Promise<void>;
}

const KEY = Symbol.for("budmon.telemetry");

type Holder = { [KEY]?: TelemetryHandle };

export function storeTelemetry(handle: TelemetryHandle): void {
  (globalThis as Holder)[KEY] = handle;
}

/** The handle the preload stored, or a no-op handle whose metrics are no-ops. */
export function getTelemetry(): TelemetryHandle {
  return (
    (globalThis as Holder)[KEY] ?? {
      metrics: createMetrics(createNoopMeter(), () => undefined),
      shutdown: () => Promise.resolve(),
    }
  );
}
