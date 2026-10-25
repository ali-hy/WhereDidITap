// F-75: the queues match the registry (schema step 6).
import type { PgBoss } from "pg-boss";
import { SchemaStepError } from "../db/schemaStepError.js";
import type { Logger } from "../observability/logger.js";
import type { WorkerRole } from "./jobs.js";
import type { JobRegistry } from "./registry.js";

const ROLES: readonly WorkerRole[] = ["general", "capture"];
const DEAD_LETTER_RETENTION_SECONDS = 2_592_000;

export async function syncQueues(
  boss: PgBoss,
  registry: JobRegistry,
  logger: Logger,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  // Idempotent: a started instance is left as it is.
  await boss.start();

  const deadLetters = new Set(ROLES.map((r) => registry.deadLetterQueue(r)));
  for (const name of deadLetters) {
    if ((await boss.getQueue(name)) === null) {
      await boss.createQueue(name, {
        policy: "standard",
        // A-227: every job lives in pgboss.job_common, which carries the row-level policies.
        partition: false,
        retentionSeconds: DEAD_LETTER_RETENTION_SECONDS,
        deleteAfterSeconds: DEAD_LETTER_RETENTION_SECONDS,
      });
      created += 1;
    }
  }

  for (const def of registry.all()) {
    const options = {
      retryLimit: def.retryLimit,
      retryDelay: def.retryDelaySeconds,
      retryBackoff: def.retryBackoff,
      expireInSeconds: def.expireInSeconds,
      deleteAfterSeconds: 604_800,
      retentionSeconds: 1_209_600,
      deadLetter: registry.deadLetterQueue(def.role),
    };
    const existing = await boss.getQueue(def.name);
    if (existing === null) {
      await boss.createQueue(def.name, { ...options, policy: def.policy, partition: false });
      created += 1;
      continue;
    }
    // A policy change needs a queue-upgrade release (D-12).
    if (existing.policy !== def.policy) throw new SchemaStepError("queue_policy_changed", def.name);
    await boss.updateQueue(def.name, options);
    updated += 1;
  }

  for (const queue of await boss.getQueues()) {
    // pg-boss's own queues (`__pgboss__send-it`, for schedules) aren't Budmon's.
    if (
      registry.get(queue.name) === undefined &&
      !deadLetters.has(queue.name) &&
      !queue.name.startsWith("__pgboss__")
    ) {
      logger.warn("queue_unregistered", { queue: queue.name });
    }
  }
  return { created, updated };
}
