// F-89: the telemetry preload (A-147). Run as `node --import ./dist/main/instrument.js
// dist/main/<api|worker>.js`: it finishes evaluating before the entry's module graph loads, so
// every instrumented module (node:http, undici, pg, fastify) loads after the instrumentations are
// registered. Nothing escapes: a failure leaves getTelemetry() a no-op.
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { metrics as metricsApi } from "@opentelemetry/api";

export { getTelemetry, type TelemetryHandle } from "../platform/observability/telemetryHandle.js";

/** `api` or `worker` from the entry's file name; anything else gets no telemetry. */
function processKind(): "api" | "worker" | undefined {
  // A-201: .js, .mjs or .ts removed, so a test fixture named worker.mjs counts as a worker.
  const base = path.basename(process.argv[1] ?? "").replace(/\.(m?js|ts)$/, "");
  return base === "api" || base === "worker" ? base : undefined;
}

async function start(): Promise<void> {
  // 1. OpenTelemetry's ESM loader hook (import-in-the-middle). F-89 names module.register: the hook
  // is an asynchronous loader, which registerHooks doesn't take.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- F-89 (A-147)
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
  // 2.
  const kind = processKind();
  if (kind === undefined) return;
  // 3. The entry reports a configuration error itself (exit 78).
  const { loadConfig } = await import("../platform/config/loadConfig.js");
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(kind, process.env, readFileSync);
  } catch {
    return;
  }
  // 4.
  const { startTelemetry } = await import("../platform/observability/otel.js");
  const { createMetrics } = await import("../platform/observability/metrics.js");
  const { storeTelemetry } = await import("../platform/observability/telemetryHandle.js");
  const roles = config.worker?.roles;
  const service =
    kind === "api" ? "api" : roles?.size === 1 ? `worker-${[...roles][0] ?? "general"}` : "worker";
  const drops: { counter?: ReturnType<ReturnType<typeof createMetrics>["counter"]> } = {};
  const telemetry = startTelemetry(
    {
      ...(config.otlpEndpoint === undefined ? {} : { endpoint: config.otlpEndpoint }),
      ...(config.otlpHeaders === undefined ? {} : { headers: config.otlpHeaders }),
      service,
      release: config.release,
      environment: config.appEnv,
    },
    {
      onDrop: (signal, dropKind, n) => {
        drops.counter?.add(n, { signal, drop_kind: dropKind });
      },
    },
  );
  // The same instrument F-42 registers; the meter provider merges the two registrations.
  drops.counter = createMetrics(metricsApi.getMeter("budmon"), () => undefined).counter(
    "telemetry_attributes_dropped_total",
    {
      description: "Telemetry attributes, fields and labels dropped",
      labels: ["signal", "drop_kind"],
    },
  );
  // 5.
  storeTelemetry(telemetry);
}

try {
  await start();
} catch {
  // No logger exists yet; getTelemetry() stays a no-op.
}
