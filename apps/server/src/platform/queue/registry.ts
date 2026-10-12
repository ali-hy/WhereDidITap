// F-71: the job registry.
import type { JobDefinition, WorkerRole } from "./jobs.js";

export interface JobRegistry {
  all(): readonly JobDefinition<unknown>[];
  forRole(r: WorkerRole): readonly JobDefinition<unknown>[];
  get(name: string): JobDefinition<unknown> | undefined;
  deadLetterQueue(r: WorkerRole): string;
}

const DEAD_LETTER_PREFIX = "dead-letter.";

export function createJobRegistry(defs: readonly JobDefinition<unknown>[]): JobRegistry {
  const byName = new Map<string, JobDefinition<unknown>>();
  for (const def of defs) {
    if (def.name.startsWith(DEAD_LETTER_PREFIX)) {
      throw new TypeError(`job names can't start with ${DEAD_LETTER_PREFIX}: ${def.name}`);
    }
    if (byName.has(def.name)) throw new TypeError(`duplicate job: ${def.name}`);
    if (def.captureSingletonKeyField !== undefined && def.sendableFromCapture !== true) {
      throw new TypeError(`captureSingletonKeyField needs sendableFromCapture: ${def.name}`);
    }
    byName.set(def.name, def);
  }
  const all = [...defs];
  return {
    all: () => all,
    forRole: (r) => all.filter((d) => d.role === r),
    get: (name) => byName.get(name),
    deadLetterQueue: (r) => `${DEAD_LETTER_PREFIX}${r}`,
  };
}
