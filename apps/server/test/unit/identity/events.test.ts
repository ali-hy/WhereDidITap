// F-21 identity events (identity LLD §4.1, DV-6). TP-0.19's unit rows, plus extra cases TP-0.19x.
// The rolled-back transaction row is in test/integration/identity/events.test.ts.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { defineJob } from "../../../src/platform/queue/jobs.js";
import type { JobQueue } from "../../../src/platform/queue/jobQueue.js";
import { createIdentityEvents } from "../../../src/identity/eventsService.js";

const userCreated = z.object({ userId: z.string(), invitationId: z.string() });
const subA = defineJob({ name: "a.on-user-created", role: "general", payload: userCreated });
const subB = defineJob({ name: "b.on-user-created", role: "general", payload: userCreated });
const subOther = defineJob({
  name: "c.on-deletion-cancelled",
  role: "general",
  payload: z.object({ userId: z.string() }),
});

const H = { inTransaction: true } as unknown as DbHandle;
const PAYLOAD = {
  userId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a30",
  invitationId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a31",
};

function fakeQueue() {
  const enqueue = vi.fn<(h: DbHandle, def: unknown, payload: unknown) => Promise<string>>(() =>
    Promise.resolve("job-id"),
  );
  return { queue: { enqueue } as unknown as JobQueue, enqueue };
}

describe("TP-0.19: identity events", () => {
  it("TP-0.19: publish with 0 subscribers enqueues nothing", async () => {
    const { queue, enqueue } = fakeQueue();
    const events = createIdentityEvents(queue);

    await events.publish(H, "identity.user-created", PAYLOAD);

    expect(enqueue).not.toHaveBeenCalled();
  });

  it("TP-0.19: publish with 2 subscribers enqueues 2 jobs, each on the caller's handle with the payload", async () => {
    const { queue, enqueue } = fakeQueue();
    const events = createIdentityEvents(queue);
    events.subscribe("identity.user-created", subA);
    events.subscribe("identity.user-created", subB);

    await events.publish(H, "identity.user-created", PAYLOAD);

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map((c) => c[1])).toEqual([subA, subB]);
    for (const call of enqueue.mock.calls) {
      expect(call[0]).toBe(H);
      expect(call[2]).toEqual(PAYLOAD);
    }
  });

  it("TP-0.19: subscribe after publish throws Error('subscribe after publish')", async () => {
    const { queue } = fakeQueue();
    const events = createIdentityEvents(queue);
    await events.publish(H, "identity.user-created", PAYLOAD);

    expect(() => {
      events.subscribe("identity.user-created", subA);
    }).toThrow("subscribe after publish");
  });
});

describe("TP-0.19x: event routing", () => {
  it("TP-0.19x: publish enqueues only the subscribers of that event", async () => {
    const { queue, enqueue } = fakeQueue();
    const events = createIdentityEvents(queue);
    events.subscribe("identity.user-created", subA);
    events.subscribe("identity.deletion-cancelled", subOther);

    await events.publish(H, "identity.deletion-cancelled", { userId: PAYLOAD.userId });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[1]).toBe(subOther);
  });

  it("TP-0.19x: subscribers() lists every subscribed definition", () => {
    const { queue } = fakeQueue();
    const events = createIdentityEvents(queue);
    events.subscribe("identity.user-created", subA);
    events.subscribe("identity.deletion-cancelled", subOther);

    expect([...events.subscribers()].sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      subA,
      subOther,
    ]);
  });

  it("TP-0.19x: an enqueue error (a payload failing the subscriber's schema) propagates from publish", async () => {
    const { queue, enqueue } = fakeQueue();
    enqueue.mockRejectedValueOnce(new Error("invalid job payload: userId invalid_type"));
    const events = createIdentityEvents(queue);
    events.subscribe("identity.user-created", subA);

    await expect(events.publish(H, "identity.user-created", PAYLOAD)).rejects.toThrow(
      "invalid job payload",
    );
  });
});
