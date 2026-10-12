// F-91: the worker process, started as `node --import ./dist/main/instrument.js
// dist/main/worker.js` (A-147). `runWorker` is the testable entry (A-201): importing this module
// doesn't start anything; the entry guard at the bottom does.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";
import { createWorkerContainer } from "../platform/container.js";
import { describeFailure } from "../platform/observability/describeFailure.js";
import { installFatalHandlers, startupState } from "../platform/observability/fatal.js";
import { createLogger } from "../platform/observability/logger.js";
import { initSentry } from "../platform/observability/sentry.js";
import { getTelemetry } from "../platform/observability/telemetryHandle.js";
import { installProxySupport } from "../platform/crypto/proxy.js";
import { buildHandlerMap } from "../platform/queue/handlers.js";
import { heartbeatFile } from "../platform/queue/heartbeat.js";
import type { JobRegistry } from "../platform/queue/registry.js";
import {
  runGeneralStartHooks,
  startWorkers,
  workerServiceName,
  type JobHandler,
} from "../platform/queue/workers.js";

const state = startupState("worker", process.env);

/** A-180: pg-boss's graceful stop gets 30 s, the rest 5 s, inside Compose's 45 s grace. */
const STOP_BUDGET_MS = 35_000;
const GRACEFUL_STOP_MS = 30_000;

/** The configuration is invalid; its problems were written to stderr (exit 78). */
export class WorkerConfigError extends Error {
  constructor() {
    super("worker configuration invalid");
    this.name = "WorkerConfigError";
  }
}

async function withDeadline(fn: () => Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    fn().catch(() => undefined),
    new Promise((resolve) => {
      timer = setTimeout(resolve, Math.max(0, ms));
    }),
  ]);
  clearTimeout(timer);
}

export async function runWorker(
  env: Readonly<Record<string, string | undefined>>,
  overrides: { registry?: JobRegistry; handlers?: ReadonlyMap<string, JobHandler> } = {},
): Promise<{ stop(): Promise<void> }> {
  // F-122: first, so every outbound connection honours the proxy variables.
  const proxy = installProxySupport(env);
  const config = loadConfigOrReport("worker", env, readFileSync, (line) =>
    process.stderr.write(`${line}\n`),
  );
  const roles = config?.worker?.roles;
  if (config === null || roles === undefined) throw new WorkerConfigError();
  // A-157: worker-general, worker-capture, or worker for several roles.
  const service = workerServiceName(roles);
  const logger = createLogger({
    service,
    release: config.release,
    level: config.logLevel,
    appEnv: config.appEnv,
  });
  state.logger = logger;
  const reporter = initSentry({
    ...(config.sentryDsn === undefined ? {} : { dsn: config.sentryDsn }),
    environment: config.appEnv,
    release: config.release,
    service,
    ...(proxy.httpsProxy === undefined ? {} : { httpsProxy: proxy.httpsProxy }),
  });
  state.reporter = reporter;

  const container = createWorkerContainer(config, {
    logger,
    reporter,
    ...(overrides.registry === undefined ? {} : { registry: overrides.registry }),
  });
  const handlers = new Map<string, JobHandler>([
    ...buildHandlerMap(container),
    ...(overrides.handlers ?? []),
  ]);
  let workers: { stop(): Promise<void> };
  try {
    // A-226: HEARTBEAT_FILE (absolute) or /tmp/heartbeat.
    workers = await startWorkers(container, handlers, { heartbeatPath: heartbeatFile(env) });
  } catch (error) {
    // A-225: within the budget, then the entry shuts telemetry down and exits 1.
    await withDeadline(() => container.close(), 5_000);
    throw error;
  }
  await runGeneralStartHooks(container);
  logger.info("worker_started");

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      const deadline = Date.now() + STOP_BUDGET_MS;
      const remaining = (cap: number): number => Math.min(cap, deadline - Date.now());
      await withDeadline(() => workers.stop(), remaining(GRACEFUL_STOP_MS));
      await withDeadline(() => container.close(), remaining(3_000));
      await withDeadline(() => getTelemetry().shutdown(), remaining(2_000));
    })();
    return stopping;
  };
  // F-91: SIGTERM/SIGINT → stop() within the budget, then exit 0 (also for runWorker's callers,
  // such as the bundle test fixture).
  const onSignal = (): void => {
    setTimeout(() => process.exit(0), STOP_BUDGET_MS).unref();
    void stop().then(() => process.exit(0));
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  return { stop };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  installFatalHandlers(state);
  try {
    await runWorker(process.env);
  } catch (error) {
    if (error instanceof WorkerConfigError) {
      process.exitCode = EXIT_CONFIG;
    } else {
      state.logger.error("startup_failed", describeFailure(error), error);
      await withDeadline(() => getTelemetry().shutdown(), 2_000);
      process.exit(1);
    }
  }
}
