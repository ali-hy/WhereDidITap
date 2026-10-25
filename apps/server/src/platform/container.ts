// F-96: the composition root. S-2 built the base members; S-4 adds the reporter, the metrics and
// the API members used so far (auth hook, module routes, A-26); S-6 the jobs (registry, queue,
// pg-boss) and the worker members. Later slices add the rest.
import { metrics as metricsApi } from "@opentelemetry/api";
import { systemClock, uuidv7Generator, type Clock, type IdGenerator } from "@budmon/shared";
import type { FastifyInstance } from "fastify";
import type { PgBoss } from "pg-boss";
import type { Config, WorkerRole } from "./config/schema.js";
import { createApiSecretsCipher, type ApiSecretsCipher } from "./crypto/apiSecrets.js";
import { createCaptureSealer, type CaptureSealer } from "./crypto/captureSealer.js";
import {
  createKmsCaptureUnsealer,
  createLocalCaptureUnsealer,
  type CaptureUnsealer,
} from "./crypto/captureUnsealer.js";
import { lazyKmsClient } from "./crypto/kmsClient.js";
import { createSealedColumnRegistry, type SealedColumnRegistry } from "./crypto/sealedColumns.js";
import { createDatabase } from "./db/client.js";
import type { Database } from "./db/types.js";
import { createFxService, type FxService } from "./fx/fxService.js";
import {
  createFawazahmed0,
  createFixedProvider,
  createOpenExchangeRates,
  type FxProviders,
} from "./fx/providers.js";
import { noAuthHook, type AuthHook } from "./http/context.js";
import { createErasureLog, type ErasureHandler, type ErasureLog } from "./storage/erasureLog.js";
import { createFsObjectStore } from "./storage/fsObjectStore.js";
import type { ObjectStore } from "./storage/objectStore.js";
import { createS3ObjectStore } from "./storage/s3ObjectStore.js";
import type { ErrorReporter } from "./observability/errorReporter.js";
import { createLogger, type Logger } from "./observability/logger.js";
import {
  createMetrics,
  registerPlatformMetrics,
  type PlatformMetrics,
} from "./observability/metrics.js";
import { initSentry } from "./observability/sentry.js";
import { buildJobRegistry } from "./queue/appRegistry.js";
import { createJobQueue, type JobQueue } from "./queue/jobQueue.js";
import type { JobRegistry } from "./queue/registry.js";
import { createPgBoss, workerServiceName } from "./queue/workers.js";
import { createIdempotency, type Idempotency } from "./idempotency/idempotency.js";
import { createCursorCodec, type CursorCodec } from "./pagination/cursor.js";
import { createRateLimiter, type RateLimiter } from "./security/rateLimiter.js";

export interface BaseContainer {
  config: Config;
  logger: Logger;
  clock: Clock;
  ids: IdGenerator;
  database: Database;
  metrics: PlatformMetrics;
  reporter: ErrorReporter;
  registry: JobRegistry;
  queue: JobQueue;
  /** The api's send-only pg-boss; a worker's queue (general) or capture instance. */
  boss: PgBoss;
  /** A-26 (F-115). */
  sealedColumns: SealedColumnRegistry;
  close(): Promise<void>;
}

/** A-26 (F-146): what erasing a user means for the modules; null until a module provides it. */
export type { ErasureHandler } from "./storage/erasureLog.js";

export interface WorkerContainer extends BaseContainer {
  roles: ReadonlySet<WorkerRole>;
  /** F-111 (S-8): null when no capture public key is configured. */
  captureSealer: CaptureSealer | null;
  /** F-112/F-113 (S-8): capture role only. The API never has one (TP-8.15). */
  captureUnsealer: CaptureUnsealer | null;
  /** General-only: pg-boss as budmon_queue (supervision and schedules). */
  queueBoss: PgBoss | null;
  /** Capture-only: pg-boss as budmon_capture. */
  captureBoss: PgBoss | null;
  erasureHandler: ErasureHandler | null;
  /** A-26 (F-78b). */
  onGeneralStarted: (() => Promise<void>)[];
  /** F-132 (S-9): every role. */
  fx: FxService;
  /** F-133 (S-9): general role only. */
  fxProviders: FxProviders | null;
  /** F-140 (S-10): general role only. */
  objectStore: ObjectStore | null;
  /** F-146 (S-10): general role only, on objectStore. */
  erasureLog: ErasureLog | null;
}

export interface ApiContainer extends BaseContainer {
  authHook: AuthHook;
  /** F-63 (S-5): shared rate limits; F-55 also registers the coarse per-IP limit with it. */
  rateLimiter: RateLimiter;
  /** F-114 (S-8). */
  apiSecrets: ApiSecretsCipher;
  /** F-111 (S-8): null when no capture public key is configured. */
  captureSealer: CaptureSealer | null;
  /** F-100 (S-7). */
  idempotency: Idempotency;
  /** F-103 (S-7), keyed by Config.api.cursorKey. */
  cursors: CursorCodec;
  /** A-26: plain Fastify routes modules register (F-55 step 4b). */
  moduleRoutes: ((app: FastifyInstance) => void)[];
  /** F-132 (S-9). */
  fx: FxService;
  /** F-140 (S-10). */
  objectStore: ObjectStore;
}

function platformMetrics(): PlatformMetrics {
  // The drop callback counts into the registered metrics, which exist once registration returns.
  const holder: { metrics?: PlatformMetrics } = {};
  holder.metrics = registerPlatformMetrics(
    createMetrics(metricsApi.getMeter("budmon"), (n) => {
      holder.metrics?.telemetryAttributesDropped.add(n, {
        signal: "metrics",
        drop_kind: "unexpected",
      });
    }),
  );
  return holder.metrics;
}

type BaseCore = Omit<BaseContainer, "registry" | "queue" | "boss" | "sealedColumns" | "close">;

function createCore(config: Config, service: string, overrides: Partial<BaseContainer>): BaseCore {
  const logger =
    overrides.logger ??
    createLogger({
      service,
      release: config.release,
      level: config.logLevel,
      appEnv: config.appEnv,
    });
  const database =
    overrides.database ??
    createDatabase(config.db, {
      applicationName: `budmon-${service}`,
      onError: () => {
        logger.error("database_pool_error");
      },
    });
  return {
    config,
    logger,
    clock: overrides.clock ?? systemClock,
    ids: overrides.ids ?? uuidv7Generator,
    database,
    metrics: overrides.metrics ?? platformMetrics(),
    reporter:
      overrides.reporter ??
      initSentry({
        ...(config.sentryDsn === undefined ? {} : { dsn: config.sentryDsn }),
        environment: config.appEnv,
        release: config.release,
        service,
      }),
  };
}

/** Stops the pg-boss instances (none is waited for: workers stop gracefully first), then the pool. */
function closer(database: Database, bosses: readonly (PgBoss | null)[]): () => Promise<void> {
  return async () => {
    for (const boss of new Set(bosses)) {
      if (boss !== null) await boss.stop({ graceful: false });
    }
    await database.close();
  };
}

function fxServiceFor(base: BaseCore, queue: JobQueue): FxService {
  return createFxService({
    database: base.database,
    queue,
    clock: base.clock,
    logger: base.logger,
    metrics: base.metrics,
  });
}

/**
 * F-133 from config.fx: live → Open Exchange Rates and fawazahmed0; fixed → fixed for both. A
 * general worker always has config.fx (A-276); null stays as a guard.
 */
function fxProvidersFor(config: Config): FxProviders | null {
  const fx = config.fx;
  if (fx === undefined) return null;
  if (fx.provider === "fixed") {
    const fixed = createFixedProvider();
    return { primary: fixed, fallback: fixed };
  }
  const deps = { fetch: globalThis.fetch.bind(globalThis) };
  return {
    primary: createOpenExchangeRates({ baseUrl: fx.primaryBaseUrl, appId: fx.primaryAppId }, deps),
    fallback: createFawazahmed0(
      { baseUrl: fx.fallbackBaseUrl, mirrorUrl: fx.fallbackMirrorUrl },
      deps,
    ),
  };
}

/**
 * F-141/F-142 from config.objectStore. Only the API presigns (A-303): its filesystem store signs
 * with the development/test key that F-145 verifies with; a worker's gets no key.
 */
function objectStoreFor(
  config: Config,
  base: BaseCore,
  fs: { publicOrigin: URL; signingKey: Buffer | null },
): ObjectStore | null {
  const store = config.objectStore;
  if (store === undefined) return null;
  if (store.kind === "s3") return createS3ObjectStore(store, { logger: base.logger });
  return createFsObjectStore({
    logger: base.logger,
    root: store.root,
    publicOrigin: fs.publicOrigin,
    signingKey: fs.signingKey,
    clock: base.clock,
  });
}

/** F-96 step 5 (A-266): every rates-added subscriber is the registry's own definition. */
function assertFxSubscribersRegistered<C extends { fx: FxService; registry: JobRegistry }>(
  c: C,
): C {
  for (const def of c.fx.subscribers()) {
    if (c.registry.get(def.name) !== def) {
      throw new TypeError(`fx subscriber not registered: ${def.name}`);
    }
  }
  return c;
}

export function createApiContainer(
  config: Config,
  overrides: Partial<ApiContainer> = {},
): ApiContainer {
  const base = createCore(config, "api", overrides);
  const rateLimitKey = config.api?.rateLimitKey;
  const cursorKey = config.api?.cursorKey;
  if (
    (overrides.rateLimiter === undefined && rateLimitKey === undefined) ||
    (overrides.cursors === undefined && cursorKey === undefined) ||
    (overrides.apiSecrets === undefined && config.api === undefined)
  ) {
    throw new Error("api config required");
  }
  const registry = overrides.registry ?? buildJobRegistry();
  const boss = overrides.boss ?? createPgBoss(config, "send-only", base.logger);
  const queue = overrides.queue ?? createJobQueue({ boss, registry });
  const objectStore =
    overrides.objectStore ??
    objectStoreFor(config, base, {
      // api config is absent only when tests override its members.
      publicOrigin: config.api?.publicOrigin ?? new URL("http://localhost"),
      signingKey: config.api?.devObjectsKey?.reveal() ?? null,
    });
  if (objectStore === null) throw new Error("object store config required");
  return assertFxSubscribersRegistered({
    ...base,
    registry,
    boss,
    objectStore,
    queue,
    fx: overrides.fx ?? fxServiceFor(base, queue),
    sealedColumns: overrides.sealedColumns ?? createSealedColumnRegistry(),
    close: closer(base.database, [boss]),
    authHook: overrides.authHook ?? noAuthHook,
    rateLimiter:
      overrides.rateLimiter ??
      createRateLimiter({
        db: base.database,
        // Checked above: present unless rateLimiter was given.
        key: (rateLimitKey as NonNullable<typeof rateLimitKey>).reveal(),
        clock: base.clock,
      }),
    moduleRoutes: overrides.moduleRoutes ?? [],
    apiSecrets:
      overrides.apiSecrets ??
      createApiSecretsCipher((config.api as NonNullable<Config["api"]>).apiSecretsKeys.reveal()),
    captureSealer:
      overrides.captureSealer !== undefined
        ? overrides.captureSealer
        : config.sealing === undefined
          ? null
          : createCaptureSealer(config.sealing),
    idempotency:
      overrides.idempotency ?? createIdempotency({ clock: base.clock, metrics: base.metrics }),
    cursors:
      overrides.cursors ??
      createCursorCodec({
        // Checked above: present unless cursors was given.
        key: (cursorKey as NonNullable<typeof cursorKey>).reveal(),
        clock: base.clock,
      }),
  });
}

/** The capture role's own key (config.capture), else the sealing key any role may hold. */
function sealingOf(config: Config): Config["sealing"] {
  const capture = config.capture;
  return capture === undefined
    ? config.sealing
    : { publicKeyPem: capture.publicKeyPem, keyVersion: capture.keyVersion };
}

function captureUnsealerFor(config: Config, metrics: PlatformMetrics): CaptureUnsealer | null {
  const kms = config.capture?.kms;
  if (kms === undefined) return null;
  return kms.provider === "local"
    ? createLocalCaptureUnsealer({
        privateKeyPem: kms.privateKeyPem.reveal(),
        keyVersion: (config.capture as NonNullable<Config["capture"]>).keyVersion,
      })
    : createKmsCaptureUnsealer({
        client: lazyKmsClient(kms.credentials.reveal()),
        metrics,
        configuredKeyVersion: (config.capture as NonNullable<Config["capture"]>).keyVersion,
      });
}

export function createWorkerContainer(
  config: Config,
  overrides: Partial<WorkerContainer> = {},
): WorkerContainer {
  const roles = config.worker?.roles;
  if (roles === undefined || roles.size === 0) throw new Error("worker config required");
  const base = createCore(config, workerServiceName(roles), overrides);
  const registry = overrides.registry ?? buildJobRegistry();
  const queueBoss =
    overrides.queueBoss !== undefined
      ? overrides.queueBoss
      : roles.has("general")
        ? createPgBoss(config, "general", base.logger)
        : null;
  const captureBoss =
    overrides.captureBoss !== undefined
      ? overrides.captureBoss
      : roles.has("capture")
        ? createPgBoss(config, "capture", base.logger)
        : null;
  // Checked above: at least one role, so at least one instance.
  const boss = overrides.boss ?? ((queueBoss ?? captureBoss) as PgBoss);
  const queue = overrides.queue ?? createJobQueue({ boss, registry });
  const objectStore =
    overrides.objectStore !== undefined
      ? overrides.objectStore
      : roles.has("general")
        ? objectStoreFor(config, base, {
            // A worker never presigns (A-303); the origin is unused without a key.
            publicOrigin: config.email?.publicOrigin ?? new URL("http://localhost"),
            signingKey: null,
          })
        : null;
  return assertFxSubscribersRegistered({
    ...base,
    roles,
    objectStore,
    erasureLog:
      overrides.erasureLog !== undefined
        ? overrides.erasureLog
        : objectStore === null
          ? null
          : createErasureLog(objectStore),
    registry,
    boss,
    queue,
    fx: overrides.fx ?? fxServiceFor(base, queue),
    fxProviders:
      overrides.fxProviders !== undefined
        ? overrides.fxProviders
        : roles.has("general")
          ? fxProvidersFor(config)
          : null,
    sealedColumns: overrides.sealedColumns ?? createSealedColumnRegistry(),
    queueBoss,
    captureBoss,
    erasureHandler: overrides.erasureHandler ?? null,
    captureSealer:
      overrides.captureSealer !== undefined
        ? overrides.captureSealer
        : sealingOf(config) === undefined
          ? null
          : createCaptureSealer(sealingOf(config) as NonNullable<Config["sealing"]>),
    captureUnsealer:
      overrides.captureUnsealer !== undefined
        ? overrides.captureUnsealer
        : roles.has("capture")
          ? captureUnsealerFor(config, base.metrics)
          : null,
    onGeneralStarted: overrides.onGeneralStarted ?? [],
    close: closer(base.database, [boss, queueBoss, captureBoss]),
  });
}
