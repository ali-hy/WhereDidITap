// Identity's test helpers (identity LLD §10.1), owned by the test-architect.
//
// - buildIdentityApi(opts): an API container on a fresh test database with a memory email sender
//   and a 5-entry common-password set, plus its server.
// - buildIdentityWorker(opts): a general worker container (same sender) on a test database, and
//   runJob(name, payload, attempt), which calls identityHandlers(c)'s handler directly.
// - setCookies(res): every set-cookie value of an inject response.
// - tokenFromEmail(sender, kind): the `#t=` token of the last email whose subject matches.
import { fixedClock, Temporal, type MutableClock } from "@budmon/shared";
import type { FastifyInstance } from "fastify";
import type { WorkerContainer } from "../../src/platform/container.js";
import { createApiServer } from "../../src/platform/http/server.js";
import { createMemoryObjectStore } from "../../src/platform/storage/memoryObjectStore.js";
import { createMemoryEmailSender, type MemoryEmailSender } from "../../src/identity/emailSender.js";
import { identityHandlers } from "../../src/identity/identityJobs.js";
import type { IdentityOverrides } from "../../src/identity/identityModule.js";
import { buildApiContainer, observed, type InjectedResponse, type Observed } from "./api.js";
import type { ApiContainerOverrides } from "../../src/platform/container.js";
import type { ApiContainer } from "../../src/platform/container.js";
import type { JobContext } from "./jobs.js";
import { recordingLogger, type LoggedLine } from "./platform.js";
import { createTestDatabase, type TestDatabase } from "./testDatabase.js";
import { testWorkerConfig } from "./worker.js";
import { createWorkerContainer } from "../../src/platform/container.js";

/** §10.1: the small common-password set tests use unless they need the real list. */
export const TEST_COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "password1234",
  "123456789012",
  "qwertyuiopas",
  "letmeinletmein",
  "budmonbudmon",
]);

/** A fixed start instant for clock-controlled tests. */
export const T0 = "2026-11-02T10:00:00.000Z";

export interface IdentityApi {
  app: FastifyInstance;
  container: ApiContainer;
  sender: MemoryEmailSender;
  clock: MutableClock;
  testDb: TestDatabase;
  obs: Observed;
  close(): Promise<void>;
}

export async function buildIdentityApi(
  opts: {
    identityOverrides?: IdentityOverrides;
    env?: Record<string, string | undefined>;
    clock?: MutableClock;
    /** Other container overrides (for example `registry: templateJobRegistry()`). */
    overrides?: ApiContainerOverrides;
  } = {},
): Promise<IdentityApi> {
  const clock = opts.clock ?? fixedClock(T0);
  const sender = createMemoryEmailSender();
  const obs = observed();
  const built = await buildApiContainer(
    {
      ...obs.overrides,
      clock,
      objectStore: createMemoryObjectStore(clock),
      ...opts.overrides,
      identityOverrides: {
        sender,
        commonPasswords: TEST_COMMON_PASSWORDS,
        ...opts.identityOverrides,
      },
    },
    opts.env ?? {},
  );
  const app = await createApiServer(built.container);
  return {
    app,
    container: built.container,
    sender,
    clock,
    testDb: built.testDb,
    obs,
    close: async () => {
      await app.close();
      await built.close();
    },
  };
}

export interface IdentityWorker {
  container: WorkerContainer;
  sender: MemoryEmailSender;
  clock: MutableClock;
  testDb: TestDatabase;
  obs: Observed;
  /** What handlers logged on their JobContext's logger (A-6: F-32 logs there). */
  jobLog: LoggedLine[];
  /** Calls identityHandlers(c)'s handler for `name` with a JobContext (`attempt` as given). */
  runJob(name: string, payload: unknown, attempt?: number): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * A general worker container on `testDb` (a fresh copy when absent), with a memory sender, a
 * memory object store, an observed logger and the given identity overrides.
 */
export async function buildIdentityWorker(
  opts: {
    testDb?: TestDatabase;
    identityOverrides?: IdentityOverrides;
    clock?: MutableClock;
    sender?: MemoryEmailSender;
  } = {},
): Promise<IdentityWorker> {
  const testDb = opts.testDb ?? (await createTestDatabase("budmon_app"));
  const ownsDb = opts.testDb === undefined;
  const clock = opts.clock ?? fixedClock(T0);
  const sender = opts.sender ?? createMemoryEmailSender();
  const obs = observed();
  const container = createWorkerContainer(
    testWorkerConfig(testDb.endpoint, testDb.name, "general", { APP_ENV: "test" }),
    {
      ...obs.overrides,
      clock,
      objectStore: createMemoryObjectStore(clock),
      identityOverrides: {
        sender,
        commonPasswords: TEST_COMMON_PASSWORDS,
        ...opts.identityOverrides,
      },
    },
  );
  const handlers = new Map(identityHandlers(container));
  const jobLog: LoggedLine[] = [];
  return {
    jobLog,
    container,
    sender,
    clock,
    testDb,
    obs,
    runJob: (name, payload, attempt = 1) => {
      const handler = handlers.get(name);
      if (handler === undefined) {
        return Promise.reject(new Error(`no identity handler for ${name}`));
      }
      const ctx: JobContext = {
        jobId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a10",
        attempt,
        createdOn: Temporal.Instant.from(T0),
        logger: recordingLogger(jobLog),
        signal: new AbortController().signal,
      };
      return handler(payload, ctx);
    },
    close: async () => {
      await container.close();
      if (ownsDb) await testDb.drop();
    },
  };
}

/** Every set-cookie value of a response, in order. */
export function setCookies(res: InjectedResponse): string[] {
  const value = res.headers["set-cookie"];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [String(value)];
}

/** The `#t=` token in the last sent email whose subject matches `subject`. */
export function tokenFromEmail(sender: MemoryEmailSender, subject: RegExp): string {
  const email = [...sender.sent].reverse().find((m) => subject.test(m.subject));
  if (email === undefined) throw new Error("no matching email");
  const match = /#t=(bm[a-z]_[A-Za-z0-9_-]{43})/.exec(email.text);
  if (match?.[1] === undefined) throw new Error("no token in the email");
  return match[1];
}
