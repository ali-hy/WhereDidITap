// F-21 publish inside a transaction (TP-0.19's integration row) and F-20 recordSecurityEvent
// (TP-0.22), with real pg-boss enqueues, plus extra cases TP-0.19x and TP-0.22x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../../src/platform/db/transaction.js";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { createJobQueue } from "../../../src/platform/queue/jobQueue.js";
import { createIdentityEvents } from "../../../src/identity/eventsService.js";
import type { IdentityDeps } from "../../../src/identity/identityModule.js";
import { recordSecurityEvent } from "../../../src/identity/securityEventsService.js";
import { userFactory } from "../../factories/identity.js";
import { buildIdentityApi, type IdentityApi } from "../../support/identity.js";
import { jobRows, registryOf, TEST_JOBS, type JobDefinition } from "../../support/jobs.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let deps: IdentityDeps;
let h: DbHandle;

beforeAll(async () => {
  api = await buildIdentityApi();
  await api.container.boss.start();
  deps = api.container.identity.deps;
  h = api.testDb.database.handle;
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
});

/** A subscriber on the template's test.ok queue, typed for identity.user-created. */
const subscriber = {
  ...TEST_JOBS.ok,
  payload: z.object({ userId: z.string(), invitationId: z.string() }),
} as unknown as JobDefinition<{ userId: string; invitationId: string }>;

const PAYLOAD = {
  userId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a60",
  invitationId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a61",
};

function events() {
  const e = createIdentityEvents(
    createJobQueue({
      boss: api.container.boss,
      registry: registryOf([subscriber]),
    }),
  );
  e.subscribe("identity.user-created", subscriber);
  return e;
}

const okJobs = async () =>
  (await jobRows(api.testDb.database, TEST_JOBS.ok.name)).filter(
    (r) => (r.data as { userId?: unknown }).userId === PAYLOAD.userId,
  );

describe("TP-0.19 (I): publishing in the caller's transaction", () => {
  it("TP-0.19: publish inside a transaction that rolls back leaves no job", async () => {
    const e = events();

    await expect(
      withTransaction(deps.database, async (tx) => {
        await e.publish(tx, "identity.user-created", PAYLOAD);
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");

    expect(await okJobs()).toEqual([]);
  });

  it("TP-0.19x: publish inside a committed transaction leaves one job with the payload", async () => {
    const e = events();

    await withTransaction(deps.database, (tx) => e.publish(tx, "identity.user-created", PAYLOAD));

    const jobs = await okJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual(PAYLOAD);
  });
});

const emailJobs = async (refId: string) =>
  (await jobRows(api.testDb.database, "identity.email-send")).filter(
    (r) => (r.data as { refId?: unknown }).refId === refId,
  );

const eventRows = async (userId: string) =>
  (
    await h.executeSql(
      "SELECT kind, session_id, client_kind FROM security_events WHERE user_id = $1",
      [userId],
    )
  ).rows;

describe("TP-0.22: recordSecurityEvent", () => {
  it("TP-0.22: with an email, inside a transaction that rolls back: no row, no job", async () => {
    const user = await userFactory(h);

    await expect(
      withTransaction(deps.database, async (tx) => {
        await recordSecurityEvent(deps, tx, {
          userId: user.id,
          kind: "password_changed",
          email: "password_changed",
        });
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");

    expect(await eventRows(user.id)).toEqual([]);
    expect(await emailJobs(user.id)).toEqual([]);
  });

  it("TP-0.22: with an email, committed: one row and one identity.email-send job (refId = user id)", async () => {
    const user = await userFactory(h);

    await withTransaction(deps.database, (tx) =>
      recordSecurityEvent(deps, tx, {
        userId: user.id,
        kind: "password_changed",
        email: "password_changed",
      }),
    );

    expect(await eventRows(user.id)).toEqual([
      { kind: "password_changed", session_id: null, client_kind: null },
    ]);
    const jobs = await emailJobs(user.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ kind: "password_changed", refId: user.id });
  });
});

describe("TP-0.22x: recordSecurityEvent details", () => {
  it("TP-0.22x: without an email, a row and no job; sessionId and clientKind are stored", async () => {
    const user = await userFactory(h);
    const sessionId = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a62";

    await withTransaction(deps.database, (tx) =>
      recordSecurityEvent(deps, tx, {
        userId: user.id,
        kind: "sign_in_succeeded",
        sessionId,
        clientKind: "web",
      }),
    );

    expect(await eventRows(user.id)).toEqual([
      { kind: "sign_in_succeeded", session_id: sessionId, client_kind: "web" },
    ]);
    expect(await emailJobs(user.id)).toEqual([]);
  });

  it("TP-0.22x: refId, when given, is the job's refId", async () => {
    const user = await userFactory(h);
    const sessionId = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a63";

    await withTransaction(deps.database, (tx) =>
      recordSecurityEvent(deps, tx, {
        userId: user.id,
        kind: "refresh_reuse_detected",
        sessionId,
        email: "session_reuse_signed_out",
        refId: sessionId,
      }),
    );

    const jobs = await emailJobs(sessionId);
    expect(jobs.map((j) => j.data)).toEqual([
      { kind: "session_reuse_signed_out", refId: sessionId },
    ]);
  });

  it("TP-0.22x: it logs info security_event with userId and reason = kind", async () => {
    const user = await userFactory(h);
    const before = api.obs.capture.records().length;

    await withTransaction(deps.database, (tx) =>
      recordSecurityEvent(deps, tx, { userId: user.id, kind: "two_step_enabled" }),
    );

    const lines = api.obs.capture
      .records()
      .slice(before)
      .filter((l) => l["event"] === "security_event");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ userId: user.id, reason: "two_step_enabled" });
  });
});
