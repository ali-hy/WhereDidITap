// F-90: the API process. Started as `node --import ./dist/main/instrument.js dist/main/api.js`
// (A-147).
import { readFileSync } from "node:fs";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";
import { createApiContainer } from "../platform/container.js";
import { createApiServer } from "../platform/http/server.js";
import { describeFailure } from "../platform/observability/describeFailure.js";
import { installFatalHandlers, startupState } from "../platform/observability/fatal.js";
import { createLogger } from "../platform/observability/logger.js";
import { initSentry } from "../platform/observability/sentry.js";
import { installProxySupport } from "../platform/crypto/proxy.js";
import { getTelemetry } from "../platform/observability/telemetryHandle.js";

const state = startupState("api", process.env);
installFatalHandlers(state);

/** A-180: the whole shutdown fits in 8 s, inside Compose's 15 s grace period. */
const SHUTDOWN_BUDGET_MS = 8_000;

/** Runs `fn`, giving up after `ms`; a rejection counts as done. */
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

/** The container once built, so a start-up failure can close it (A-225). */
let started: { close(): Promise<void> } | undefined;

async function main(): Promise<number | null> {
  // F-122: first, so every outbound connection honours the proxy variables.
  const proxy = installProxySupport(process.env);
  const config = loadConfigOrReport("api", process.env, readFileSync, (line) =>
    process.stderr.write(`${line}\n`),
  );
  if (config?.api === undefined) return EXIT_CONFIG;

  const logger = createLogger({
    service: "api",
    release: config.release,
    level: config.logLevel,
    appEnv: config.appEnv,
  });
  state.logger = logger;
  // Started by the `--import` preload (F-89, A-147); a no-op handle when it didn't run.
  const telemetry = getTelemetry();
  const container = createApiContainer(config, {
    logger,
    reporter: initSentry({
      ...(config.sentryDsn === undefined ? {} : { dsn: config.sentryDsn }),
      environment: config.appEnv,
      release: config.release,
      service: "api",
      ...(proxy.httpsProxy === undefined ? {} : { httpsProxy: proxy.httpsProxy }),
    }),
  });
  started = container;
  state.reporter = container.reporter;
  // A-209: the send-only pg-boss; container.close() stops it.
  await container.boss.start();
  const app = await createApiServer(container);
  await app.listen({ port: config.api.port, host: config.api.host });
  // service and release are fixed keys on every line (A-113).
  logger.info("api_started");

  const stop = (): void => {
    const deadline = Date.now() + SHUTDOWN_BUDGET_MS;
    const remaining = (cap: number): number => Math.min(cap, deadline - Date.now());
    // When the budget runs out, exit anyway: unflushed telemetry is dropped.
    setTimeout(() => process.exit(0), SHUTDOWN_BUDGET_MS).unref();
    void (async () => {
      await withDeadline(() => app.close(), remaining(5_000));
      await withDeadline(() => container.close(), remaining(2_000));
      await withDeadline(() => telemetry.shutdown(), remaining(2_000));
      process.exit(0);
    })();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return null;
}

main().then(
  (code) => {
    if (code !== null) process.exitCode = code;
  },
  (error: unknown) => {
    state.logger.error("startup_failed", describeFailure(error), error);
    // A-225: close what was started (the send-only pg-boss, A-209, and the pool), then telemetry,
    // within the shutdown budget; then exit 1.
    const deadline = Date.now() + SHUTDOWN_BUDGET_MS;
    const remaining = (cap: number): number => Math.min(cap, deadline - Date.now());
    setTimeout(() => process.exit(1), SHUTDOWN_BUDGET_MS).unref();
    void (async () => {
      const container = started;
      if (container !== undefined) await withDeadline(() => container.close(), remaining(5_000));
      await withDeadline(() => getTelemetry().shutdown(), remaining(2_000));
      process.exit(1);
    })();
  },
);
