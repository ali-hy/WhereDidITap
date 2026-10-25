// F-73: enqueueing jobs, in the caller's transaction when it has one.
import type { PgBoss } from "pg-boss";
import type { Temporal } from "@budmon/shared";
import type { DbHandle } from "../db/types.js";
import type { JobDefinition } from "./jobs.js";
import { assertPayloadSafe } from "./payloadSafety.js";
import type { JobRegistry } from "./registry.js";

export interface JobQueue {
  enqueue<P>(
    h: DbHandle,
    def: JobDefinition<P>,
    payload: P,
    opts?: { singletonKey?: string; startAfter?: Temporal.Instant },
  ): Promise<string | null>;
}

/** A payload that doesn't match its schema. The message names issue paths and codes only. */
export class JobPayloadInvalidError extends Error {
  constructor(issues: readonly { path: readonly PropertyKey[]; code: string }[]) {
    super(
      `invalid job payload: ${issues
        .map((issue) => `${issue.path.map(String).join(".")} ${issue.code}`)
        .join(", ")}`,
    );
    this.name = "JobPayloadInvalidError";
  }
}

export function createJobQueue(deps: { boss: PgBoss; registry: JobRegistry }): JobQueue {
  return {
    async enqueue(h, def, payload, opts = {}) {
      if (deps.registry.get(def.name) === undefined) {
        throw new Error(`job not registered: ${def.name}`);
      }
      const parsed = def.payload.safeParse(payload);
      if (!parsed.success) throw new JobPayloadInvalidError(parsed.error.issues);
      assertPayloadSafe(parsed.data);
      return deps.boss.send(def.name, parsed.data as object, {
        // The caller's handle: in its transaction, the job commits or rolls back with it.
        db: { executeSql: (text: string, values?: unknown[]) => h.executeSql(text, values) },
        retryLimit: def.retryLimit,
        retryDelay: def.retryDelaySeconds,
        retryBackoff: def.retryBackoff,
        expireInSeconds: def.expireInSeconds,
        ...(opts.singletonKey === undefined ? {} : { singletonKey: opts.singletonKey }),
        ...(opts.startAfter === undefined
          ? {}
          : { startAfter: new Date(opts.startAfter.epochMilliseconds) }),
        deadLetter: deps.registry.deadLetterQueue(def.role),
      });
    },
  };
}
