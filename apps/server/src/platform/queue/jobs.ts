// F-70: job definitions.
import type { z } from "zod";
import type { WorkerRole } from "../config/schema.js";

export type { WorkerRole } from "../config/schema.js";

export type QueuePolicy = "standard" | "stately" | "singleton" | "short";

export interface JobDefinition<P> {
  readonly name: string;
  readonly role: WorkerRole;
  readonly payload: z.ZodType<P>;
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds: number;
  readonly policy: QueuePolicy;
  readonly cron?: string;
  /** A-227: a general job that worker-capture may enqueue (F-75b's INSERT policy). */
  readonly sendableFromCapture?: boolean;
  /**
   * A-283: the payload field capture's rows must use as their singleton key (with `created` state
   * and the queue's policy), pinned by F-75b's INSERT policy. Only with `sendableFromCapture`.
   */
  readonly captureSingletonKeyField?: string;
}

/** `<module>.<job>`, the same rule as F-30's job names. */
export const JOB_NAME_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
/** One cron field: numbers, `*`, steps, ranges and lists. */
const CRON_FIELD = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/;

function isCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  return fields.length === 5 && fields.every((field) => CRON_FIELD.test(field));
}

export function defineJob<P>(
  def: { name: string; role: WorkerRole; payload: z.ZodType<P> } & Partial<
    Omit<JobDefinition<P>, "name" | "role" | "payload">
  >,
): JobDefinition<P> {
  if (!JOB_NAME_PATTERN.test(def.name)) throw new TypeError(`invalid job name: ${def.name}`);
  if (def.cron !== undefined) {
    if (def.role !== "general") throw new TypeError(`a scheduled job must be general: ${def.name}`);
    if (!isCron(def.cron)) throw new TypeError(`invalid cron for ${def.name}`);
  }
  return {
    retryLimit: 5,
    retryDelaySeconds: 30,
    retryBackoff: true,
    expireInSeconds: 900,
    policy: "standard",
    sendableFromCapture: false,
    ...def,
  };
}
