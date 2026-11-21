// F-130 runIdentityPurge, F-11 pruneRefreshTokens and the identity.purge job (identity LLD §4.1,
// §4.4, F-33). TP-3.25, TP-3.56, plus extra cases ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { randomBytes } from "node:crypto";
import { fixedClock, Temporal, uuidv7Generator } from "@budmon/shared";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../../src/platform/db/transaction.js";
import type { DbHandle } from "../../../src/platform/db/types.js";
import * as challengesRepo from "../../../src/identity/challengesRepo.js";
import { REFRESH_PRUNE_AGE } from "../../../src/identity/constants.js";
import * as exportsRepo from "../../../src/identity/exportsRepo.js";
import type { IdentityDeps } from "../../../src/identity/identityModule.js";
import { runIdentityPurge } from "../../../src/identity/purgeService.js";
import * as securityEventsRepo from "../../../src/identity/securityEventsRepo.js";
import { createSession } from "../../../src/identity/sessionService.js";
import * as sessionsRepo from "../../../src/identity/sessionsRepo.js";
import * as twoStepRepo from "../../../src/identity/twoStepRepo.js";
import { generateToken, hashToken } from "../../../src/identity/tokens.js";
import {
  invitationFactory,
  knownDeviceFactory,
  resetFactory,
  sessionFactory,
  twoStepFactory,
  userFactory,
} from "../../factories/identity.js";
import {
  buildIdentityApi,
  buildIdentityWorker,
  T0,
  type IdentityApi,
} from "../../support/identity.js";
import { call, errorOf } from "../../support/identityHttp.js";
import { jobRows, templateJobRegistry, TEST_JOBS, type JobDefinition } from "../../support/jobs.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let deps: IdentityDeps;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const ids = uuidv7Generator;
const days = (n: number) => ({ hours: 24 * n });
const at = (i: Temporal.Instant): Date => new Date(i.epochMilliseconds);
const ms = (d: unknown): number | null => (d === null ? null : (d as Date).getTime());
const before = (i: Temporal.Instant) => i.subtract({ milliseconds: 1 });

/** A subscriber on the template's test.ok queue, recording identity.invitation-ended payloads. */
const recorder = {
  ...TEST_JOBS.ok,
  payload: z.record(z.string(), z.unknown()),
} as unknown as JobDefinition<never>;

beforeAll(async () => {
  api = await buildIdentityApi({ overrides: { registry: templateJobRegistry() } });
  api.container.identity.events.subscribe("identity.invitation-ended", recorder);
  await api.container.boss.start();
  deps = api.container.identity.deps;
  h = api.testDb.database.handle;
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
  api.clock.set(T0);
});

const exists = async (table: string, id: string, idColumn = "id"): Promise<boolean> =>
  (await h.executeSql(`SELECT 1 FROM ${table} WHERE ${idColumn} = $1`, [id])).rows.length === 1;

const purgedLines = (from: number) =>
  api.obs.capture
    .records()
    .slice(from)
    .filter((l) => l["event"] === "identity_purged")
    .map((l) => ({ step: l["step"], count: l["count"] }));

/** A refresh row inserted through F-11 (superseded `rotated` when `supersededAt` is given). */
async function refreshRow(input: {
  id: string;
  sessionId: string;
  parentId: string | null;
  generation: number;
  issuedAt: Temporal.Instant;
  supersededAt?: Temporal.Instant;
}): Promise<void> {
  const { id } = input;
  await sessionsRepo.insertRefresh(h, {
    id,
    sessionId: input.sessionId,
    parentId: input.parentId,
    generation: input.generation,
    tokenHash: hashToken(generateToken("refresh")),
    issuedAt: at(input.issuedAt),
  });
  if (input.supersededAt !== undefined) {
    await sessionsRepo.markRefresh(h, id, {
      firstPresentedAt: at(input.supersededAt),
      supersededAt: at(input.supersededAt),
      supersededReason: "rotated",
    });
  }
}

/** A live session (idle expiry `now + 10 d`) whose current token is `currentId`. */
async function liveSession(userId: string, now: Temporal.Instant, currentId: string) {
  const sessionId = ids.next();
  await sessionsRepo.insertSession(h, {
    id: sessionId,
    userId,
    delivery: "bearer",
    clientKind: "android",
    deviceLabel: "Android · Test",
    authMethod: "password",
    accessTokenHash: hashToken(generateToken("access")),
    accessExpiresAt: at(now.add({ minutes: 15 })),
    currentRefreshId: currentId,
    idleExpiresAt: at(now.add(days(10))),
    confirmedAt: at(now),
    lastUsedAt: at(now),
  });
  return sessionId;
}

describe("TP-3.25: runIdentityPurge's boundaries", () => {
  it("TP-3.25: only rows past their boundary are removed or flipped; the counts are returned; refresh_tokens is purged (and logged) before sessions", async () => {
    const user = await userFactory(h);

    // invitations_expired: pending ∧ expires_at ≤ now.
    const invDue = await invitationFactory(h, {
      email: "due@example.com",
      now: NOW,
      expiresAt: NOW,
    });
    const invLive = await invitationFactory(h, {
      email: "live@example.com",
      now: NOW,
      expiresAt: NOW.add({ milliseconds: 1 }),
    });

    // challenges: coalesce(consumed_at, expires_at) < now − 1 h.
    const challengeCut = NOW.subtract({ hours: 1 });
    const challenge = async (expiresAt: Temporal.Instant, consumedAt?: Temporal.Instant) => {
      const id = ids.next();
      await challengesRepo.insert(h, {
        id,
        kind: "two_step",
        tokenHash: hashToken(generateToken("challenge")),
        userId: user.id,
        data: {
          kind: "two_step",
          delivery: "bearer",
          method: "password",
          pendingLink: null,
          clientKind: "android",
          deviceLabel: "Android · Test",
        },
        expiresAt: at(expiresAt),
      });
      if (consumedAt !== undefined) await challengesRepo.consume(h, id, at(consumedAt));
      return id;
    };
    const chExpiredPast = await challenge(before(challengeCut));
    const chExpiredAtCut = await challenge(challengeCut);
    const chConsumedPast = await challenge(challengeCut.add({ minutes: 4 }), before(challengeCut));
    const chConsumedAtCut = await challenge(challengeCut.add({ minutes: 4 }), challengeCut);

    // resets: coalesce(used_at, invalidated_at, expires_at) < now − 24 h.
    const resetCut = NOW.subtract({ hours: 24 });
    const rsExpiredPast = await resetFactory(h, {
      userId: user.id,
      now: NOW,
      expiresAt: before(resetCut),
    });
    const rsExpiredAtCut = await resetFactory(h, {
      userId: user.id,
      now: NOW,
      expiresAt: resetCut,
    });
    const rsUsedPast = await resetFactory(h, {
      userId: user.id,
      now: NOW,
      expiresAt: resetCut.add({ minutes: 29 }),
      usedAt: before(resetCut),
    });

    // refresh_tokens: superseded, issued_at < now − 90 d, never the current token or its parent.
    const pruneCut = NOW.subtract(days(90));
    const gen1 = ids.next();
    const gen2 = ids.next();
    const gen3 = ids.next();
    const gen4 = ids.next();
    const sessionForChain = await liveSession(user.id, NOW, gen4);
    await refreshRow({
      id: gen1,
      sessionId: sessionForChain,
      parentId: null,
      generation: 1,
      issuedAt: before(pruneCut),
      supersededAt: pruneCut,
    });
    await refreshRow({
      id: gen2,
      sessionId: sessionForChain,
      parentId: gen1,
      generation: 2,
      issuedAt: pruneCut,
      supersededAt: NOW.subtract(days(60)),
    });
    await refreshRow({
      id: gen3,
      sessionId: sessionForChain,
      parentId: gen2,
      generation: 3,
      issuedAt: NOW.subtract(days(60)),
      supersededAt: NOW.subtract(days(20)),
    });
    await refreshRow({
      id: gen4,
      sessionId: sessionForChain,
      parentId: gen3,
      generation: 4,
      issuedAt: NOW.subtract(days(20)),
    });

    // sessions: revoked_at < now − 30 d, or idle_expires_at < now − 30 d.
    const sessionCut = NOW.subtract(days(30));
    const ssRevokedPast = await sessionFactory(h, {
      userId: user.id,
      now: NOW.subtract(days(40)),
      revoked: { reason: "sign_out", at: before(sessionCut) },
    });
    const ssRevokedAtCut = await sessionFactory(h, {
      userId: user.id,
      now: NOW.subtract(days(40)),
      revoked: { reason: "sign_out", at: sessionCut },
    });
    const ssIdlePast = await sessionFactory(h, {
      userId: user.id,
      now: NOW.subtract(days(70)),
      idleExpiresAt: before(sessionCut),
    });
    const ssIdleAtCut = await sessionFactory(h, {
      userId: user.id,
      now: NOW.subtract(days(70)),
      idleExpiresAt: sessionCut,
    });

    // invitations_ended: revoked or expired with ended_at < now − 90 d.
    const endedCut = NOW.subtract(days(90));
    const invEndedPast = await invitationFactory(h, {
      email: "ended-past@example.com",
      now: NOW.subtract(days(100)),
      revokedAt: before(endedCut),
    });
    const invEndedAtCut = await invitationFactory(h, {
      email: "ended-cut@example.com",
      now: NOW.subtract(days(100)),
      revokedAt: endedCut,
    });

    // security_events: created_at < now − 90 d.
    const eventCut = NOW.subtract(days(90));
    const event = async (createdAt: Temporal.Instant) => {
      const id = ids.next();
      await securityEventsRepo.insert(h, {
        id,
        userId: user.id,
        kind: "sign_in_succeeded",
        sessionId: null,
        clientKind: "android",
      });
      await h.executeSql("UPDATE security_events SET created_at = $2 WHERE id = $1", [
        id,
        at(createdAt),
      ]);
      return id;
    };
    const evPast = await event(before(eventCut));
    const evAtCut = await event(eventCut);

    // exports: ready ∧ expires_at ≤ now → expired; expired/failed with
    // coalesce(expires_at, completed_at) < now − 30 d → deleted.
    const exportCut = NOW.subtract(days(30));
    const exportRow = async (
      outcome: { ready: Temporal.Instant } | { failed: Temporal.Instant },
    ): Promise<string> => {
      const id = ids.next();
      await exportsRepo.insertQueued(h, {
        id,
        userId: user.id,
        requestedAt: at(NOW.subtract(days(60))),
      });
      await exportsRepo.markRunning(h, id, at(NOW.subtract(days(60))));
      if ("ready" in outcome) {
        await exportsRepo.markReady(h, id, {
          objectKey: `exports/${id}.zip`,
          byteSize: 10,
          completedAt: at(NOW.subtract(days(7))),
          expiresAt: at(outcome.ready),
        });
      } else {
        await exportsRepo.markFailed(h, id, "build_failed", at(outcome.failed));
      }
      return id;
    };
    const exReadyDue = await exportRow({ ready: NOW });
    const exReadyLive = await exportRow({ ready: NOW.add({ milliseconds: 1 }) });
    const exFailedPast = await exportRow({ failed: before(exportCut) });
    const exFailedAtCut = await exportRow({ failed: exportCut });

    // two_step_pending: pending rows, and enabled rows' pending columns, with pending_expires_at < now.
    const envelope = randomBytes(48);
    const pendingPast = await userFactory(h);
    await twoStepRepo.upsertPending(h, pendingPast.id, envelope, at(before(NOW)));
    const pendingAtNow = await userFactory(h);
    await twoStepRepo.upsertPending(h, pendingAtNow.id, envelope, at(NOW));
    const apiSecrets = deps.apiSecrets;
    if (apiSecrets === null) throw new Error("the API has no apiSecrets");
    const enabledPast = await userFactory(h);
    await twoStepFactory(h, apiSecrets, { userId: enabledPast.id, now: NOW.subtract(days(1)) });
    await twoStepRepo.upsertPending(h, enabledPast.id, envelope, at(before(NOW)));
    const enabledAtNow = await userFactory(h);
    await twoStepFactory(h, apiSecrets, { userId: enabledAtNow.id, now: NOW.subtract(days(1)) });
    await twoStepRepo.upsertPending(h, enabledAtNow.id, envelope, at(NOW));

    // known_devices: expired (expires_at before now) → deleted.
    const kdPast = await knownDeviceFactory(h, {
      userId: user.id,
      now: NOW.subtract(days(400)),
      expiresAt: before(NOW),
    });
    const kdLive = await knownDeviceFactory(h, {
      userId: user.id,
      now: NOW.subtract(days(10)),
      expiresAt: NOW.add({ milliseconds: 1 }),
    });

    const logFrom = api.obs.capture.records().length;

    const counts = await runIdentityPurge(deps);

    expect(counts).toEqual({
      invitations_expired: 1,
      challenges: 2,
      resets: 2,
      refresh_tokens: 1,
      sessions: 2,
      invitations_ended: 1,
      security_events: 1,
      exports: 2,
      two_step_pending: 2,
      known_devices: 1,
    });

    const invRow = async (id: string) =>
      (await h.executeSql("SELECT status, ended_at FROM invitations WHERE id = $1", [id])).rows[0];
    expect(await invRow(invDue.invitationId)).toMatchObject({ status: "expired" });
    expect(ms((await invRow(invDue.invitationId))?.["ended_at"])).toBe(NOW.epochMilliseconds);
    expect(await invRow(invLive.invitationId)).toMatchObject({ status: "pending" });
    const published = (await jobRows(api.testDb.database, TEST_JOBS.ok.name)).map((r) => r.data);
    expect(published).toEqual([{ invitationId: invDue.invitationId, reason: "expired" }]);

    expect(await exists("auth_challenges", chExpiredPast)).toBe(false);
    expect(await exists("auth_challenges", chExpiredAtCut)).toBe(true);
    expect(await exists("auth_challenges", chConsumedPast)).toBe(false);
    expect(await exists("auth_challenges", chConsumedAtCut)).toBe(true);

    expect(await exists("password_resets", rsExpiredPast.resetId)).toBe(false);
    expect(await exists("password_resets", rsExpiredAtCut.resetId)).toBe(true);
    expect(await exists("password_resets", rsUsedPast.resetId)).toBe(false);

    expect(await exists("session_refresh_tokens", gen1)).toBe(false);
    expect(await exists("session_refresh_tokens", gen2)).toBe(true);
    expect(await exists("session_refresh_tokens", gen3)).toBe(true);
    expect(await exists("session_refresh_tokens", gen4)).toBe(true);
    expect(await exists("sessions", sessionForChain)).toBe(true);

    expect(await exists("sessions", ssRevokedPast.sessionId)).toBe(false);
    expect(await exists("session_refresh_tokens", ssRevokedPast.refreshId)).toBe(false);
    expect(await exists("sessions", ssRevokedAtCut.sessionId)).toBe(true);
    expect(await exists("sessions", ssIdlePast.sessionId)).toBe(false);
    expect(await exists("sessions", ssIdleAtCut.sessionId)).toBe(true);

    expect(await exists("invitations", invEndedPast.invitationId)).toBe(false);
    expect(await exists("invitations", invEndedAtCut.invitationId)).toBe(true);

    expect(await exists("security_events", evPast)).toBe(false);
    expect(await exists("security_events", evAtCut)).toBe(true);

    expect((await exportsRepo.findById(h, exReadyDue))?.status).toBe("expired");
    expect((await exportsRepo.findById(h, exReadyLive))?.status).toBe("ready");
    expect(await exportsRepo.findById(h, exFailedPast)).toBeNull();
    expect((await exportsRepo.findById(h, exFailedAtCut))?.status).toBe("failed");

    expect(await twoStepRepo.get(h, pendingPast.id)).toBeNull();
    expect(await twoStepRepo.get(h, pendingAtNow.id)).toMatchObject({ state: "pending" });
    expect(await twoStepRepo.get(h, enabledPast.id)).toMatchObject({
      state: "enabled",
      pendingSecretEnvelope: null,
      pendingExpiresAt: null,
    });
    expect((await twoStepRepo.get(h, enabledPast.id))?.secretEnvelope).not.toBeNull();
    expect(ms((await twoStepRepo.get(h, enabledAtNow.id))?.pendingExpiresAt ?? null)).toBe(
      NOW.epochMilliseconds,
    );

    expect(await exists("known_devices", kdPast.deviceId)).toBe(false);
    expect(await exists("known_devices", kdLive.deviceId)).toBe(true);

    const lines = purgedLines(logFrom);
    expect(lines).toHaveLength(10);
    expect(lines).toEqual(
      expect.arrayContaining(
        Object.entries(counts).map(([step, count]) => ({ step, count })),
      ) as unknown,
    );
    const steps = lines.map((l) => l.step);
    expect(steps.indexOf("refresh_tokens")).toBeLessThan(steps.indexOf("sessions"));
  });

  it("TP-3.25x: with nothing to purge every step returns 0 and still logs", async () => {
    const logFrom = api.obs.capture.records().length;

    const counts = await runIdentityPurge(deps);

    expect(Object.values(counts)).toEqual(Array.from({ length: 10 }, () => 0));
    expect(purgedLines(logFrom)).toHaveLength(10);
  });

  it("TP-3.25x (A-73): a known device expiring exactly now is purged; one expiring 1 ms later is kept", async () => {
    const user = await userFactory(h);
    const atNow = await knownDeviceFactory(h, {
      userId: user.id,
      now: NOW.subtract(days(400)),
      expiresAt: NOW,
    });
    const later = await knownDeviceFactory(h, {
      userId: user.id,
      now: NOW.subtract(days(10)),
      expiresAt: NOW.add({ milliseconds: 1 }),
    });

    const counts = await runIdentityPurge(deps);

    expect(counts.known_devices).toBe(1);
    expect(await exists("known_devices", atNow.deviceId)).toBe(false);
    expect(await exists("known_devices", later.deviceId)).toBe(true);
  });

  it("TP-3.25x: the identity.purge handler runs F-130 with the worker's identity deps", async () => {
    const user = await userFactory(h);
    const expired = await knownDeviceFactory(h, {
      userId: user.id,
      now: NOW.subtract(days(400)),
      expiresAt: before(NOW),
    });
    const worker = await buildIdentityWorker({ testDb: api.testDb, clock: fixedClock(T0) });
    try {
      await worker.runJob("identity.purge", {});
    } finally {
      await worker.close();
    }

    expect(await exists("known_devices", expired.deviceId)).toBe(false);
  });
});

describe("TP-3.56: refresh-token pruning against a long-lived session", () => {
  const refresh = (refreshToken: string) =>
    call(api.app, "POST", "/auth/refresh", { tokenDelivery: "body", refreshToken });

  async function refreshAt(when: Temporal.Instant, token: string): Promise<string> {
    api.clock.set(when.toString());
    const res = await refresh(token);
    expect(res.status).toBe(200);
    return (res.json() as { tokens: { refreshToken: string } }).tokens.refreshToken;
  }

  const rowOf = async (token: string) =>
    (
      await h.executeSql("SELECT id FROM session_refresh_tokens WHERE token_hash = $1", [
        hashToken(token),
      ])
    ).rows[0];

  it("TP-3.56: (a) at t0 + 125 d the purge keeps the session and deletes only T1 and T2; (b) T2 → REFRESH_INVALID without revocation; (c) the 89-day-old T3 still revokes reuse_detected with the event and the email job", async () => {
    const user = await userFactory(h);
    const issued = await withTransaction(deps.database, (tx) =>
      createSession(deps, tx, {
        userId: user.id,
        delivery: "bearer",
        clientKind: "android",
        deviceLabel: "Android · Pixel 8",
        authMethod: "password",
        presentedDeviceToken: null,
      }),
    );
    const t1 = issued.refreshToken;
    const t2 = await refreshAt(NOW.add(days(29)), t1);
    const t3 = await refreshAt(NOW.add(days(36)), t2);
    const t4 = await refreshAt(NOW.add(days(65)), t3);
    const t5 = await refreshAt(NOW.add(days(94)), t4);
    const t6 = await refreshAt(NOW.add(days(123)), t5);
    const now = NOW.add(days(125));
    api.clock.set(now.toString());

    // (a)
    const counts = await runIdentityPurge(deps);

    expect(counts["refresh_tokens"]).toBe(2);
    const session = (
      await h.executeSql("SELECT revoked_at, idle_expires_at FROM sessions WHERE id = $1", [
        issued.sessionId,
      ])
    ).rows[0];
    expect(session?.["revoked_at"]).toBeNull();
    expect(ms(session?.["idle_expires_at"])).toBe(NOW.add(days(153)).epochMilliseconds);
    expect(await rowOf(t1)).toBeUndefined();
    expect(await rowOf(t2)).toBeUndefined();
    for (const t of [t3, t4, t5, t6]) expect(await rowOf(t)).toBeDefined();

    // (b)
    const presentedT2 = await refresh(t2);

    expect(presentedT2.status).toBe(401);
    expect(errorOf(presentedT2).code).toBe("REFRESH_INVALID");
    expect(
      (await h.executeSql("SELECT revoked_at FROM sessions WHERE id = $1", [issued.sessionId]))
        .rows[0]?.["revoked_at"],
    ).toBeNull();
    expect(
      (
        await h.executeSql("SELECT count(*)::int AS n FROM security_events WHERE user_id = $1", [
          user.id,
        ])
      ).rows[0]?.["n"],
    ).toBe(0);
    const emails = async () =>
      (await jobRows(api.testDb.database, "identity.email-send"))
        .map((r) => r.data as Record<string, unknown>)
        .filter((d) => d["refId"] === issued.sessionId);
    expect(await emails()).toEqual([]);

    // (c)
    const presentedT3 = await refresh(t3);

    expect(errorOf(presentedT3).code).toBe("REFRESH_INVALID");
    const revoked = (
      await h.executeSql("SELECT revoked_at, revoke_reason FROM sessions WHERE id = $1", [
        issued.sessionId,
      ])
    ).rows[0];
    expect(revoked?.["revoke_reason"]).toBe("reuse_detected");
    expect(ms(revoked?.["revoked_at"])).toBe(now.epochMilliseconds);
    const events = (
      await h.executeSql("SELECT id, kind FROM security_events WHERE user_id = $1", [user.id])
    ).rows;
    expect(events.map((e) => e["kind"])).toEqual(["refresh_reuse_detected"]);
    expect(await emails()).toEqual([
      { kind: "session_reuse_signed_out", refId: issued.sessionId, eventId: events[0]?.["id"] },
    ]);
  });

  it("TP-3.56: (d) a live session whose current token (1 d old) has a superseded parent 100 d old and a grandparent 101 d old → pruneRefreshTokens returns 1: only the grandparent is deleted", async () => {
    const now = NOW.add(days(125));
    const user = await userFactory(h);
    const grandparent = ids.next();
    const parent = ids.next();
    const current = ids.next();
    const sessionId = await liveSession(user.id, now, current);
    await refreshRow({
      id: grandparent,
      sessionId,
      parentId: null,
      generation: 1,
      issuedAt: now.subtract(days(101)),
      supersededAt: now.subtract(days(100)),
    });
    await refreshRow({
      id: parent,
      sessionId,
      parentId: grandparent,
      generation: 2,
      issuedAt: now.subtract(days(100)),
      supersededAt: now.subtract(days(1)),
    });
    await refreshRow({
      id: current,
      sessionId,
      parentId: parent,
      generation: 3,
      issuedAt: now.subtract(days(1)),
    });

    const pruned = await sessionsRepo.pruneRefreshTokens(
      h,
      at(now.subtract(REFRESH_PRUNE_AGE)),
      5000,
    );

    expect(pruned).toBe(1);
    expect(await exists("session_refresh_tokens", grandparent)).toBe(false);
    expect(await exists("session_refresh_tokens", parent)).toBe(true);
    expect(await exists("session_refresh_tokens", current)).toBe(true);
  });
});
