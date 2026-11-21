// F-21: identity's events. Each subscriber's own job is enqueued in the publishing transaction.
import type { DbHandle } from "../platform/db/types.js";
import type { JobDefinition } from "../platform/queue/jobs.js";
import type { JobQueue } from "../platform/queue/jobQueue.js";

export type IdentityEventName =
  | "identity.user-created"
  | "identity.preferences-changed"
  | "identity.deletion-requested"
  | "identity.deletion-cancelled"
  | "identity.invitation-ended";

export interface IdentityEventPayloads {
  "identity.user-created": { userId: string; invitationId: string };
  "identity.preferences-changed": {
    userId: string;
    fields: ("baseCurrency" | "timeZone" | "locale")[];
  };
  "identity.deletion-requested": { userId: string; requestedBy: "self" | "owner" | "ban" };
  "identity.deletion-cancelled": { userId: string };
  "identity.invitation-ended": { invitationId: string; reason: "expired" | "revoked" };
}

export interface IdentityEvents {
  subscribe<E extends IdentityEventName>(
    event: E,
    def: JobDefinition<IdentityEventPayloads[E]>,
  ): void;
  publish<E extends IdentityEventName>(
    h: DbHandle,
    event: E,
    payload: IdentityEventPayloads[E],
  ): Promise<void>;
  /** Every subscribed definition, for the container's registry check. */
  subscribers(): readonly JobDefinition<unknown>[];
}

export function createIdentityEvents(queue: JobQueue): IdentityEvents {
  const byEvent = new Map<IdentityEventName, JobDefinition<unknown>[]>();
  let published = false;
  return {
    subscribe(event, def) {
      if (published) throw new Error("subscribe after publish");
      const list = byEvent.get(event) ?? [];
      list.push(def);
      byEvent.set(event, list);
    },
    async publish(h, event, payload) {
      published = true;
      for (const def of byEvent.get(event) ?? []) {
        await queue.enqueue(h, def, payload);
      }
    },
    subscribers() {
      return [...byEvent.values()].flat();
    },
  };
}
