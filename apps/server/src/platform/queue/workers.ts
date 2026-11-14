// F-77 createPgBoss, F-78 startWorkers and F-78b runGeneralStartHooks.
import { Temporal, utcDateOf } from "@budmon/shared";
import { PgBoss } from "pg-boss";
import type { Config } from "../config/schema.js";
import type { WorkerContainer } from "../container.js";
import { latestDayOnOrBefore } from "../fx/fxRepo.js";
import { describeFailure } from "../observability/describeFailure.js";
import type { Logger } from "../observability/logger.js";
import { startHeartbeat } from "./heartbeat.js";
import { wrapHandler, type JobContext } from "./wrapper.js";

export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<unknown>;

export class MissingQueueError extends Error {
  constructor(readonly queue: string) {
    super(`queue missing: ${queue}`);
    this.name = "MissingQueueError";
  }
}

/**
 * F-77. send-only (the api) uses the configured database login (`budmon_app`); general and cli use
 * the queue login (`budmon_queue`). capture uses `budmon_capture` (DB_USER) in a capture-only
 * worker, and the queue login when the worker also runs general (A-299); only the login changes,
 * so its pool and instance registration stay capture's.
 */
export function createPgBoss(
  cfg: Config,
  mode: "send-only" | "capture" | "general" | "cli",
  logger?: Logger,
): PgBoss {
  const queue = cfg.worker?.queue;
  // A-299: a worker that also runs general (development only) gives its capture instance the
  // queue login; a capture-only worker connects as DB_USER (budmon_capture, F-10).
  const queueLogin =
    mode === "general" ||
    mode === "cli" ||
    (mode === "capture" && cfg.worker?.roles.has("general") === true);
  if (queueLogin && queue === undefined) {
    throw new Error(`a ${mode} pg-boss needs the queue login`);
  }
  const login =
    queueLogin && queue !== undefined
      ? {
          user: queue.user,
          password: queue.password.reveal(),
          // A-218: a one-off command needs only a small pool.
          max: mode === "cli" ? 2 : mode === "capture" ? 3 : queue.poolMax,
        }
      : {
          user: cfg.db.user,
          password: cfg.db.password.reveal(),
          max: mode === "send-only" ? 2 : 3,
        };
  const boss = new PgBoss({
    host: cfg.db.host,
    port: cfg.db.port,
    database: cfg.db.name,
    ...login,
    application_name: `budmon-${mode}`,
    ssl:
      cfg.db.sslmode === "verify-full"
        ? { ca: cfg.db.sslRootCert, rejectUnauthorized: true, servername: cfg.db.host }
        : false,
    schema: "pgboss",
    migrate: false,
    createSchema: false,
    useListenNotify: false,
    supervise: mode === "general",
    schedule: mode === "general",
    // The instance registry prunes with DELETE, which only the schema's owner (budmon_queue) has
    // (F-74 grants budmon_app and budmon_capture SELECT, INSERT and UPDATE).
    registerInstance: mode === "general" || mode === "cli",
  });
  boss.on("error", (error) => {
    logger?.error("queue_error", describeFailure(error), error);
  });
  return boss;
}

function rolesBosses(c: WorkerContainer): { role: "general" | "capture"; boss: PgBoss }[] {
  const out: { role: "general" | "capture"; boss: PgBoss }[] = [];
  if (c.roles.has("general") && c.queueBoss !== null)
    out.push({ role: "general", boss: c.queueBoss });
  if (c.roles.has("capture") && c.captureBoss !== null) {
    out.push({ role: "capture", boss: c.captureBoss });
  }
  return out;
}

/** Epoch seconds of `day` + 1 day at 00:00Z (F-42, A-265). */
function fxDayEndEpochSeconds(day: string): number {
  return (
    Temporal.PlainDate.from(day).add({ days: 1 }).toZonedDateTime({ timeZone: "UTC" })
      .epochMilliseconds / 1000
  );
}

/** The service name (A-157): `worker-<role>` for one role, `worker` for several. */
export function workerServiceName(roles: ReadonlySet<string>): string {
  return roles.size === 1 ? `worker-${[...roles][0] ?? "general"}` : "worker";
}

export async function startWorkers(
  c: WorkerContainer,
  handlers: ReadonlyMap<string, JobHandler>,
  opts: { heartbeatPath?: string } = {},
): Promise<{ stop(): Promise<void> }> {
  const started: PgBoss[] = [];
  let heartbeat: { stop(): void } | undefined;
  let depthTimer: NodeJS.Timeout | undefined;
  let depths: { value: number; labels: Record<string, string> }[] = [];
  let fxLastDay: { value: number; labels: Record<string, string> }[] = [];
  const stop = async (): Promise<void> => {
    heartbeat?.stop();
    clearInterval(depthTimer);
    // The pool stays open (close: false), so the container can still use the instance (for
    // example dead-letter commands); container.close() closes it.
    for (const boss of started) {
      await boss.stop({ graceful: true, timeout: 30_000, close: false });
    }
  };
  try {
    for (const { role, boss } of rolesBosses(c)) {
      // 1.
      await boss.start();
      started.push(boss);
      for (const def of c.registry.forRole(role)) {
        // 2.
        if ((await boss.getQueue(def.name)) === null) {
          c.logger.error("queue_missing", { queue: def.name });
          throw new MissingQueueError(def.name);
        }
        const handler = handlers.get(def.name);
        if (handler === undefined) throw new Error(`no handler for ${def.name}`);
        // 3.
        await boss.work(
          def.name,
          { batchSize: 1, pollingIntervalSeconds: 2, includeMetadata: true, perJobResults: true },
          wrapHandler(def, handler, {
            logger: c.logger,
            metrics: c.metrics,
            reporter: c.reporter,
            clock: c.clock,
          }),
        );
      }
      if (role === "general") {
        // 4.
        for (const def of c.registry.forRole("general")) {
          if (def.cron !== undefined) await boss.schedule(def.name, def.cron, {}, { tz: "UTC" });
        }
        c.metrics.observeQueueDepth(() => depths);
        // A-265: the FX freshness gauge, when the FX jobs are registered.
        const observeFx = c.registry.get("platform.fx-rates-fetch") !== undefined;
        if (observeFx) c.metrics.observeFxLastDay(() => fxLastDay);
        const refresh = async (): Promise<void> => {
          try {
            depths = (await boss.getQueues()).map((q) => ({
              value: q.queuedCount,
              labels: { queue: q.name },
            }));
          } catch {
            // The gauge keeps its last values.
          }
          if (!observeFx) return;
          try {
            const today = utcDateOf(c.clock.now()).toString();
            const day = await latestDayOnOrBefore(c.database.handle, today);
            fxLastDay = day === null ? [] : [{ value: fxDayEndEpochSeconds(day), labels: {} }];
          } catch {
            // The gauge keeps its last value.
          }
        };
        await refresh();
        depthTimer = setInterval(() => void refresh(), 60_000);
        depthTimer.unref();
        // A-203: only when the fx module has registered it.
        const gapCheck = c.registry.get("platform.fx-gap-check");
        if (gapCheck !== undefined) {
          await c.queue.enqueue(c.database.handle, gapCheck, {}, { singletonKey: "startup" });
        }
      }
    }
    // 5.
    heartbeat = startHeartbeat({
      metrics: c.metrics,
      logger: c.logger,
      clock: c.clock,
      service: workerServiceName(c.roles),
      ...(opts.heartbeatPath === undefined ? {} : { path: opts.heartbeatPath }),
    });
  } catch (error) {
    await stop().catch(() => undefined);
    throw error;
  }
  return { stop };
}

/** F-78b (A-26): the general role's start-up hooks, in order; a failing hook doesn't stop the rest. */
export async function runGeneralStartHooks(
  c: Pick<WorkerContainer, "roles" | "onGeneralStarted" | "logger" | "reporter">,
): Promise<void> {
  if (!c.roles.has("general")) return;
  for (const [index, hook] of c.onGeneralStarted.entries()) {
    try {
      await hook();
    } catch (err) {
      c.reporter.report(err, { route: "worker:onGeneralStarted" });
      c.logger.error(
        "worker_start_hook_failed",
        { step: `onGeneralStarted:${String(index)}` },
        err,
      );
    }
  }
}
