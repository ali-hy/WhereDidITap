// F-34: the identity module's composition. The platform's container builds it after its own
// members and hands it to every module that needs identity (`container.identity`).
import { metrics as metricsApi } from "@opentelemetry/api";
import type { Clock, IdGenerator } from "@budmon/shared";
import type { FastifyInstance } from "fastify";
import type { Config } from "../platform/config/schema.js";
import type { ApiSecretsCipher } from "../platform/crypto/apiSecrets.js";
import type { BaseContainer, ErasureHandler } from "../platform/container.js";
import type { Database } from "../platform/db/types.js";
import type { AuthHook } from "../platform/http/context.js";
import type { ErrorReporter } from "../platform/observability/errorReporter.js";
import type { Logger } from "../platform/observability/logger.js";
import { createMetrics, type PlatformMetrics } from "../platform/observability/metrics.js";
import type { CursorCodec } from "../platform/pagination/cursor.js";
import type { JobQueue } from "../platform/queue/jobQueue.js";
import type { JobRegistry } from "../platform/queue/registry.js";
import type { RateLimiter } from "../platform/security/rateLimiter.js";
import type { ErasureLog } from "../platform/storage/erasureLog.js";
import type { ObjectStore } from "../platform/storage/objectStore.js";
import { createAuthHook } from "./authHook.js";
import { createSmtpEmailSender, type EmailSender } from "./emailSender.js";
import { createIdentityEvents, type IdentityEvents } from "./eventsService.js";
import { registerIdentityMetrics, type IdentityMetrics } from "./identityMetrics.js";
import { createPasswordHasher, type PasswordHasher } from "./passwordHasher.js";
import { loadCommonPasswords } from "./passwordPolicy.js";
import { defaultPorts, type IdentityPorts } from "./ports.js";

export interface IdentityDeps {
  config: Config;
  database: Database;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  reporter: ErrorReporter;
  platformMetrics: PlatformMetrics;
  metrics: IdentityMetrics;
  registry: JobRegistry;
  queue: JobQueue;
  /** API only. */
  rateLimiter: RateLimiter | null;
  /** API only. */
  apiSecrets: ApiSecretsCipher | null;
  /** API only. */
  cursors: CursorCodec | null;
  objectStore: ObjectStore | null;
  /** Worker-general only. */
  erasureLog: ErasureLog | null;
  events: IdentityEvents;
  ports: IdentityPorts;
  hasher: PasswordHasher;
  /** Worker-general only. */
  sender: EmailSender | null;
  /** The memoised common-password list (LD-5). */
  commonPasswords: () => ReadonlySet<string>;
}

export type IdentityBase = Pick<
  BaseContainer,
  | "config"
  | "logger"
  | "clock"
  | "ids"
  | "database"
  | "metrics"
  | "reporter"
  | "registry"
  | "queue"
  | "sealedColumns"
> & {
  rateLimiter?: RateLimiter;
  apiSecrets?: ApiSecretsCipher;
  cursors?: CursorCodec;
  objectStore?: ObjectStore | null;
  erasureLog?: ErasureLog | null;
};

export interface IdentityOverrides {
  ports?: Partial<IdentityPorts>;
  sender?: EmailSender;
  hasher?: PasswordHasher;
  metrics?: IdentityMetrics;
  commonPasswords?: ReadonlySet<string>;
  /** E2E only: supplied by identity/e2eSupport.ts; this file never imports the e2e files. */
  testRoutes?: (app: FastifyInstance, deps: IdentityDeps) => void;
}

export interface IdentityModule {
  deps: IdentityDeps;
  authHook: AuthHook;
  events: IdentityEvents;
  ports: IdentityPorts;
  /** Null until S-11. */
  erasureHandler: ErasureHandler | null;
  routes: readonly ((app: FastifyInstance) => void)[];
  /** Null until S-11. */
  onGeneralWorkerStarted: (() => Promise<void>) | null;
}

/** Lists sorted by `order`; a repeated module name is a composition error. */
function composePorts(overrides: Partial<IdentityPorts> | undefined): IdentityPorts {
  const ports: IdentityPorts = { ...defaultPorts(), ...overrides };
  for (const list of [
    ports.deletionPrechecks,
    ports.erasureParticipants,
    ports.exportParticipants,
  ]) {
    const names = new Set<string>();
    for (const { module } of list) {
      if (names.has(module)) throw new TypeError(`duplicate identity port module: ${module}`);
      names.add(module);
    }
  }
  return {
    ...ports,
    erasureParticipants: [...ports.erasureParticipants].sort((a, b) => a.order - b.order),
    exportParticipants: [...ports.exportParticipants].sort((a, b) => a.order - b.order),
  };
}

export function createIdentityModule(
  base: IdentityBase,
  overrides: IdentityOverrides = {},
): IdentityModule {
  const ports = composePorts(overrides.ports);
  // F-34: the TOTP secrets, sealed by the API's cipher; one context for both columns.
  for (const column of ["secret_envelope", "pending_secret_envelope"]) {
    base.sealedColumns.register({
      table: "two_step_credentials",
      idColumn: "user_id",
      column,
      purpose: "totp",
      provider: "api",
    });
  }
  const events = createIdentityEvents(base.queue);
  const metrics =
    overrides.metrics ??
    registerIdentityMetrics(
      createMetrics(metricsApi.getMeter("budmon"), (n) => {
        base.metrics.telemetryAttributesDropped.add(n, {
          signal: "metrics",
          drop_kind: "unexpected",
        });
      }),
    );
  const common = overrides.commonPasswords;
  const deps: IdentityDeps = {
    config: base.config,
    database: base.database,
    clock: base.clock,
    ids: base.ids,
    logger: base.logger,
    reporter: base.reporter,
    platformMetrics: base.metrics,
    metrics,
    registry: base.registry,
    queue: base.queue,
    rateLimiter: base.rateLimiter ?? null,
    apiSecrets: base.apiSecrets ?? null,
    cursors: base.cursors ?? null,
    objectStore: base.objectStore ?? null,
    erasureLog: base.erasureLog ?? null,
    events,
    ports,
    hasher: overrides.hasher ?? createPasswordHasher(),
    sender:
      overrides.sender ??
      (base.config.email === undefined
        ? null
        : createSmtpEmailSender(base.config.email, base.config.appEnv)),
    commonPasswords: common === undefined ? () => loadCommonPasswords() : () => common,
  };

  const testRoutes = overrides.testRoutes;
  return {
    deps,
    authHook: createAuthHook(deps),
    events,
    ports,
    erasureHandler: null,
    onGeneralWorkerStarted: null,
    routes:
      testRoutes === undefined
        ? []
        : [
            (app) => {
              testRoutes(app, deps);
            },
          ],
  };
}

/** Every event subscriber's definition is the registry's own, so a missing registration fails at start. */
export function assertIdentitySubscribersRegistered(c: {
  identity: IdentityModule;
  registry: JobRegistry;
}): void {
  for (const def of c.identity.events.subscribers()) {
    if (c.registry.get(def.name) !== def) {
      throw new TypeError(`identity subscriber not registered: ${def.name}`);
    }
  }
}
