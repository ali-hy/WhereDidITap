// auth.refresh (F-25, LD-3) through the real HTTP layer: rules R1 to R4 and R3b, both 60 s windows
// (inclusive), races, idle expiry without an absolute lifetime, and the per-session limit (identity
// LLD §4.1, §5.2, §6). TP-3.8 to TP-3.18, plus extra cases ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../../src/platform/db/transaction.js";
import type { DbHandle } from "../../../src/platform/db/types.js";
import type { IdentityDeps } from "../../../src/identity/identityModule.js";
import { createSession } from "../../../src/identity/sessionService.js";
import { generateToken, hashToken } from "../../../src/identity/tokens.js";
import { sessionFactory, userFactory } from "../../factories/identity.js";
import {
  buildIdentityApi,
  cookieHeader,
  cookieJar,
  setCookies,
  T0,
  type IdentityApi,
} from "../../support/identity.js";
import { call, errorOf, nextIp, TAILNET } from "../../support/identityHttp.js";
import { jobRows } from "../../support/jobs.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let deps: IdentityDeps;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const days = (n: number) => ({ hours: 24 * n });
const wire = (i: Temporal.Instant): string => i.toString({ fractionalSecondDigits: 3 });
const INVALID = {
  defined: true,
  code: "REFRESH_INVALID",
  status: 401,
  message: "Refresh token invalid",
};

beforeAll(async () => {
  api = await buildIdentityApi();
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

interface TokensWire {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  deviceToken: string | null;
}

/** auth.refresh with body delivery (an Android client), from a fresh IP unless given. */
const refresh = (refreshToken: string, ip?: string) =>
  call(
    api.app,
    "POST",
    "/auth/refresh",
    { tokenDelivery: "body", refreshToken },
    ip === undefined ? {} : { ip },
  );

/** The new tokens of a 200 body-delivery refresh. */
function tokensOf(res: Awaited<ReturnType<typeof refresh>>): TokensWire {
  expect(res.status).toBe(200);
  return (res.json() as { tokens: TokensWire }).tokens;
}

/** Refreshes at `at` and returns the new refresh token. */
async function refreshAt(at: Temporal.Instant, token: string): Promise<string> {
  api.clock.set(at.toString());
  return tokensOf(await refresh(token)).refreshToken;
}

/** A bearer session made by F-23 at the clock's now; its first refresh token is T1. */
async function newSession() {
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
  return { user, sessionId: issued.sessionId, t1: issued.refreshToken, issued };
}

interface RefreshRowView {
  id: string;
  parentId: string | null;
  generation: number;
  issuedAt: number;
  firstPresentedAt: number | null;
  supersededAt: number | null;
  supersededReason: string | null;
}

const ms = (d: unknown): number | null => (d === null ? null : (d as Date).getTime());

/** The stored row of a plain refresh token, or null when it isn't stored. */
async function rowOf(token: string): Promise<RefreshRowView | null> {
  const { rows } = await h.executeSql(
    "SELECT * FROM session_refresh_tokens WHERE token_hash = $1",
    [hashToken(token)],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r["id"] as string,
    parentId: r["parent_id"] as string | null,
    generation: r["generation"] as number,
    issuedAt: ms(r["issued_at"]) ?? 0,
    firstPresentedAt: ms(r["first_presented_at"]),
    supersededAt: ms(r["superseded_at"]),
    supersededReason: r["superseded_reason"] as string | null,
  };
}

async function must(token: string): Promise<RefreshRowView> {
  const row = await rowOf(token);
  if (row === null) throw new Error("no refresh row for the token");
  return row;
}

async function sessionRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await h.executeSql("SELECT * FROM sessions WHERE id = $1", [id]);
  if (rows[0] === undefined) throw new Error("no session row");
  return rows[0];
}

const tokenCount = async (sessionId: string): Promise<number> =>
  (
    await h.executeSql(
      "SELECT count(*)::int AS n FROM session_refresh_tokens WHERE session_id = $1",
      [sessionId],
    )
  ).rows[0]?.["n"] as number;

const eventKinds = async (userId: string): Promise<string[]> =>
  (
    await h.executeSql(
      "SELECT kind FROM security_events WHERE user_id = $1 ORDER BY created_at, id",
      [userId],
    )
  ).rows.map((r) => r["kind"] as string);

const reuseEmails = async (sessionId: string) =>
  (await jobRows(api.testDb.database, "identity.email-send"))
    .map((r) => r.data as Record<string, unknown>)
    .filter((d) => d["refId"] === sessionId);

/** Expects the session revoked for reuse at `at`, with one event and one reuse email for it. */
async function expectRevokedForReuse(sessionId: string, userId: string, at: Temporal.Instant) {
  const row = await sessionRow(sessionId);
  expect(row["revoke_reason"]).toBe("reuse_detected");
  expect(ms(row["revoked_at"])).toBe(at.epochMilliseconds);
  expect(await eventKinds(userId)).toEqual(["refresh_reuse_detected"]);
  const { rows } = await h.executeSql(
    "SELECT id FROM security_events WHERE user_id = $1 AND kind = 'refresh_reuse_detected'",
    [userId],
  );
  expect(await reuseEmails(sessionId)).toEqual([
    { kind: "session_reuse_signed_out", refId: sessionId, eventId: rows[0]?.["id"] },
  ]);
}

/** Expects the session live, with no event and no email. */
async function expectLiveAndQuiet(sessionId: string, userId: string) {
  const row = await sessionRow(sessionId);
  expect(row["revoked_at"]).toBeNull();
  expect(await eventKinds(userId)).toEqual([]);
  expect(await reuseEmails(sessionId)).toEqual([]);
}

describe("TP-3.8: R1 and no absolute lifetime", () => {
  it("TP-3.8: refreshing at t0 + 29, 58, 87 and 100 days and 100 days + 1 min keeps the session alive; expiries move with each refresh; the replaced access token stops working at once", async () => {
    const { user, sessionId, t1 } = await newSession();
    const t2 = await refreshAt(NOW.add(days(29)), t1);
    const t3 = await refreshAt(NOW.add(days(58)), t2);
    const t4 = await refreshAt(NOW.add(days(87)), t3);
    const at100 = NOW.add(days(100));
    api.clock.set(at100.toString());
    const res100 = await refresh(t4);
    const tokens100 = tokensOf(res100);

    expect(res100.json()).toEqual({
      tokens: {
        accessToken: tokens100.accessToken,
        refreshToken: tokens100.refreshToken,
        accessExpiresAt: wire(at100.add({ minutes: 15 })),
        refreshExpiresAt: wire(at100.add(days(30))),
        deviceToken: null,
      },
      accessExpiresAt: wire(at100.add({ minutes: 15 })),
    });
    const after100 = await sessionRow(sessionId);
    expect(ms(after100["idle_expires_at"])).toBe(NOW.add(days(130)).epochMilliseconds);
    expect(ms(after100["access_expires_at"])).toBe(at100.add({ minutes: 15 }).epochMilliseconds);
    expect(ms(after100["last_used_at"])).toBe(at100.epochMilliseconds);

    const last = at100.add({ minutes: 1 });
    api.clock.set(last.toString());
    const t6 = tokensOf(await refresh(tokens100.refreshToken));

    const hook = api.container.identity.authHook;
    const bearer = (token: string) => ({
      headers: { host: TAILNET, authorization: `Bearer ${token}` },
      cookies: {},
    });
    expect(await hook.authenticate(bearer(tokens100.accessToken))).toBeNull();
    expect(await hook.authenticate(bearer(t6.accessToken))).toEqual({
      userId: user.id,
      isOwner: false,
      sessionId,
    });
    const first = await must(t1);
    expect(first).toMatchObject({
      generation: 1,
      parentId: null,
      supersededReason: "rotated",
      firstPresentedAt: NOW.add(days(29)).epochMilliseconds,
      supersededAt: NOW.add(days(29)).epochMilliseconds,
    });
    expect(await tokenCount(sessionId)).toBe(6);
    await expectLiveAndQuiet(sessionId, user.id);
  });

  it("TP-3.8x: each R1 issues the next generation from the presented token", async () => {
    const { sessionId, t1 } = await newSession();

    const t2 = await refreshAt(NOW.add({ minutes: 20 }), t1);

    const r1 = await must(t1);
    const r2 = await must(t2);
    expect(r2).toMatchObject({
      parentId: r1.id,
      generation: 2,
      issuedAt: NOW.add({ minutes: 20 }).epochMilliseconds,
      firstPresentedAt: null,
      supersededAt: null,
    });
    expect((await sessionRow(sessionId))["current_refresh_id"]).toBe(r2.id);
  });

  it("TP-3.8x: the users.last_active_at touch (F-25 step 6)", async () => {
    const { user, t1 } = await newSession();
    const at = NOW.add(days(2));

    await refreshAt(at, t1);

    const { rows } = await h.executeSql("SELECT last_active_at FROM users WHERE id = $1", [
      user.id,
    ]);
    expect(ms(rows[0]?.["last_active_at"])).toBe(at.epochMilliseconds);
  });
});

describe("TP-3.9: tokens that never refresh", () => {
  it.each([
    ["a malformed token", () => "bmr_short"],
    ["a well-formed unknown token", () => generateToken("refresh")],
    ["a token of another kind", () => generateToken("access")],
  ])("TP-3.9: %s → 401 REFRESH_INVALID", async (_label, token) => {
    const res = await refresh(token());

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(INVALID);
  });

  it("TP-3.9: a revoked session's current token → REFRESH_INVALID, nothing changes", async () => {
    const user = await userFactory(h);
    const s = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      revoked: { reason: "sign_out", at: NOW.subtract({ minutes: 1 }) },
    });

    const res = await refresh(s.refreshToken);

    expect(errorOf(res)).toEqual(INVALID);
    expect(await must(s.refreshToken)).toMatchObject({
      firstPresentedAt: null,
      supersededAt: null,
    });
    expect(await tokenCount(s.sessionId)).toBe(1);
    expect(await eventKinds(user.id)).toEqual([]);
  });

  it("TP-3.9: idle expiry reached (idleExpiresAt = now) → REFRESH_INVALID, nothing changes; with idleExpiresAt = now + 1 ms it refreshes", async () => {
    const user = await userFactory(h);
    const expired = await sessionFactory(h, { userId: user.id, now: NOW, idleExpiresAt: NOW });
    const live = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      idleExpiresAt: NOW.add({ milliseconds: 1 }),
    });

    const refused = await refresh(expired.refreshToken);
    const accepted = await refresh(live.refreshToken);

    expect(errorOf(refused)).toEqual(INVALID);
    expect(await tokenCount(expired.sessionId)).toBe(1);
    expect((await sessionRow(expired.sessionId))["revoked_at"]).toBeNull();
    expect(accepted.status).toBe(200);
    expect(ms((await sessionRow(live.sessionId))["idle_expires_at"])).toBe(
      NOW.add(days(30)).epochMilliseconds,
    );
  });

  it("TP-3.9: a cookie session's token sent as body → REFRESH_INVALID; the same token still refreshes through the cookie", async () => {
    const user = await userFactory(h);
    const s = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      delivery: "cookie",
      clientKind: "web",
    });

    const asBody = await refresh(s.refreshToken);
    const asCookie = await call(
      api.app,
      "POST",
      "/auth/refresh",
      { tokenDelivery: "cookie" },
      {
        client: "web/1",
        headers: { cookie: cookieHeader({ "__Secure-budmon_rt": s.refreshToken }) },
      },
    );

    expect(errorOf(asBody)).toEqual(INVALID);
    expect(asCookie.status).toBe(200);
    expect(asCookie.json()).toEqual({
      tokens: null,
      accessExpiresAt: wire(NOW.add({ minutes: 15 })),
    });
    const jar = cookieJar(asCookie);
    expect(jar["__Secure-budmon_at"]).toMatch(/^bma_/);
    expect(jar["__Secure-budmon_rt"]).toMatch(/^bmr_/);
    expect(await must(s.refreshToken)).toMatchObject({ supersededReason: "rotated" });
  });

  it("TP-3.9x: a bearer session's token sent as the refresh cookie → REFRESH_INVALID", async () => {
    const user = await userFactory(h);
    const s = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "bearer" });

    const res = await call(
      api.app,
      "POST",
      "/auth/refresh",
      { tokenDelivery: "cookie" },
      {
        client: "web/1",
        headers: { cookie: cookieHeader({ "__Secure-budmon_rt": s.refreshToken }) },
      },
    );

    expect(errorOf(res)).toEqual(INVALID);
    expect(await tokenCount(s.sessionId)).toBe(1);
  });

  it("TP-3.9x: cookie delivery with no refresh cookie → REFRESH_INVALID", async () => {
    const res = await call(
      api.app,
      "POST",
      "/auth/refresh",
      { tokenDelivery: "cookie" },
      {
        client: "web/1",
      },
    );

    expect(errorOf(res)).toEqual(INVALID);
  });

  it("TP-3.9x: body delivery without refreshToken → 400 VALIDATION_FAILED (path refreshToken, code required)", async () => {
    const res = await call(api.app, "POST", "/auth/refresh", { tokenDelivery: "body" });

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      code: "VALIDATION_FAILED",
      data: { issues: [{ path: ["refreshToken"], code: "required", message: "Required" }] },
    });
  });

  it("TP-3.9x: a cookie refresh sets the refresh cookie's Max-Age to the new idle expiry (30 days)", async () => {
    const user = await userFactory(h);
    const s = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      delivery: "cookie",
      clientKind: "web",
    });

    const res = await call(
      api.app,
      "POST",
      "/auth/refresh",
      { tokenDelivery: "cookie" },
      {
        client: "web/1",
        headers: { cookie: cookieHeader({ "__Secure-budmon_rt": s.refreshToken }) },
      },
    );

    expect(setCookies(res)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^__Secure-budmon_rt=bmr_[A-Za-z0-9_-]{43}; Path=\/api\/v1\/auth\/refresh; Max-Age=2592000;/,
        ),
      ]) as unknown,
    );
  });
});

describe("TP-3.10: R2, the benign predecessor", () => {
  it("TP-3.10: T1 → T2 (T2 unpresented); refreshing with T1 again → 200; T2 discarded; T3's parent is T1", async () => {
    const { user, sessionId, t1 } = await newSession();
    const t2 = await refreshAt(NOW.add({ minutes: 20 }), t1);
    const at = NOW.add({ minutes: 40 });

    const t3 = await refreshAt(at, t1);

    const r1 = await must(t1);
    expect(await must(t2)).toMatchObject({
      supersededReason: "discarded",
      supersededAt: at.epochMilliseconds,
      firstPresentedAt: null,
    });
    expect(await must(t3)).toMatchObject({ parentId: r1.id, generation: 2, supersededAt: null });
    expect((await sessionRow(sessionId))["current_refresh_id"]).toBe((await must(t3)).id);
    await expectLiveAndQuiet(sessionId, user.id);
  });
});

describe("TP-3.11: R4, reuse", () => {
  it("TP-3.11: T1 → T2 → T3 (T2 presented); presenting T1 → 401 REFRESH_INVALID, the session revoked reuse_detected, an event and the session_reuse_signed_out email job", async () => {
    const { user, sessionId, t1 } = await newSession();
    const t2 = await refreshAt(NOW.add({ minutes: 20 }), t1);
    const t3 = await refreshAt(NOW.add({ minutes: 40 }), t2);
    const at = NOW.add({ minutes: 60 });
    api.clock.set(at.toString());

    const res = await refresh(t1);

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(INVALID);
    await expectRevokedForReuse(sessionId, user.id, at);
    expect(errorOf(await refresh(t3))).toEqual(INVALID);
  });
});

describe("TP-3.12 to TP-3.15: R3 and its two 60 s windows", () => {
  /**
   * T1 → R1 issues T2 at t; a concurrent R2 with T1 at t + `discardAfter` issues T3 and discards T2.
   */
  async function raced(discardAfter: Temporal.DurationLike) {
    const s = await newSession();
    const t = NOW.add({ minutes: 20 });
    const t2 = await refreshAt(t, s.t1);
    const discardAt = t.add(discardAfter);
    const t3 = await refreshAt(discardAt, s.t1);
    return { ...s, t, t2, t3, discardAt };
  }

  it("TP-3.12: presenting T2 at t + 1 s + 60 s exactly → 200 with T4 (parent T2); T3 discarded; the session live; no event, no email", async () => {
    const s = await raced({ seconds: 1 });
    const at = s.discardAt.add({ seconds: 60 });
    api.clock.set(at.toString());

    const t4 = tokensOf(await refresh(s.t2)).refreshToken;

    const r2 = await must(s.t2);
    expect(r2).toMatchObject({
      firstPresentedAt: at.epochMilliseconds,
      supersededReason: "rotated",
    });
    expect(await must(t4)).toMatchObject({ parentId: r2.id, generation: 3 });
    expect(await must(s.t3)).toMatchObject({
      supersededReason: "discarded",
      supersededAt: at.epochMilliseconds,
    });
    expect((await sessionRow(s.sessionId))["current_refresh_id"]).toBe((await must(t4)).id);
    await expectLiveAndQuiet(s.sessionId, s.user.id);
  });

  it("TP-3.13: presenting T2 at the discard + 60.001 s → 401; revoked reuse_detected; event; email", async () => {
    const s = await raced({ seconds: 1 });
    const at = s.discardAt.add({ seconds: 60, milliseconds: 1 });
    api.clock.set(at.toString());

    const res = await refresh(s.t2);

    expect(errorOf(res)).toEqual(INVALID);
    await expectRevokedForReuse(s.sessionId, s.user.id, at);
  });

  it("TP-3.14: a thief redeems T1 20 minutes after T2 was issued (R2), then the device presents T2 1 s later → the thief's 200, the device's 401 with the session revoked, event and email", async () => {
    const s = await newSession();
    const t = NOW.add({ minutes: 20 });
    const t2 = await refreshAt(t, s.t1);
    const theft = t.add({ minutes: 20 });
    api.clock.set(theft.toString());

    const thief = await refresh(s.t1);
    const deviceAt = theft.add({ seconds: 1 });
    api.clock.set(deviceAt.toString());
    const device = await refresh(t2);

    expect(thief.status).toBe(200);
    expect(errorOf(device)).toEqual(INVALID);
    await expectRevokedForReuse(s.sessionId, s.user.id, deviceAt);
  });

  it("TP-3.15: T2 discarded exactly 60 s after its issue, presented 1 s after the discard → 200 (R3)", async () => {
    const s = await raced({ seconds: 60 });
    api.clock.set(s.discardAt.add({ seconds: 1 }).toString());

    const res = await refresh(s.t2);

    expect(res.status).toBe(200);
    await expectLiveAndQuiet(s.sessionId, s.user.id);
  });

  it("TP-3.15: T2 discarded 60.001 s after its issue, presented 1 s after the discard → 401, revoked", async () => {
    const s = await raced({ seconds: 60, milliseconds: 1 });
    const at = s.discardAt.add({ seconds: 1 });
    api.clock.set(at.toString());

    const res = await refresh(s.t2);

    expect(errorOf(res)).toEqual(INVALID);
    await expectRevokedForReuse(s.sessionId, s.user.id, at);
  });
});

describe("TP-3.16: R4 after normal rotations, and R3b", () => {
  it("TP-3.16: (a) T1 → T2 → T3 → T4 by normal rotations; presenting T1 → revoked", async () => {
    const s = await newSession();
    const t2 = await refreshAt(NOW.add({ minutes: 20 }), s.t1);
    const t3 = await refreshAt(NOW.add({ minutes: 40 }), t2);
    await refreshAt(NOW.add({ minutes: 60 }), t3);
    const at = NOW.add({ minutes: 80 });
    api.clock.set(at.toString());

    const res = await refresh(s.t1);

    expect(errorOf(res)).toEqual(INVALID);
    await expectRevokedForReuse(s.sessionId, s.user.id, at);
  });

  it("TP-3.16: (b) TP-3.12's state after T3 was presented once; presenting T2 within both windows → 401, not revoked, no event (R3b)", async () => {
    const s = await newSession();
    const t = NOW.add({ minutes: 20 });
    const t2 = await refreshAt(t, s.t1);
    const t3 = await refreshAt(t.add({ seconds: 1 }), s.t1);
    const t5 = await refreshAt(t.add({ seconds: 2 }), t3);
    api.clock.set(t.add({ seconds: 3 }).toString());

    const res = await refresh(t2);

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(INVALID);
    await expectLiveAndQuiet(s.sessionId, s.user.id);
    expect(await must(t2)).toMatchObject({ firstPresentedAt: null, supersededReason: "discarded" });
    expect((await sessionRow(s.sessionId))["current_refresh_id"]).toBe((await must(t5)).id);
    expect(tokensOf(await refresh(t5)).refreshToken).toMatch(/^bmr_/);
  });
});

describe("TP-3.17: concurrent refreshes (option (a))", () => {
  it("TP-3.17: two concurrent refreshes with T1 → both 200 (R1 then R2); the losing response's token presented within 60 s → 200 (R3), session live, no event", async () => {
    const s = await newSession();
    const t = NOW.add({ minutes: 20 });
    api.clock.set(t.toString());

    const [a, b] = await Promise.all([refresh(s.t1), refresh(s.t1)]);
    const ta = tokensOf(a).refreshToken;
    const tb = tokensOf(b).refreshToken;
    const rows = [await must(ta), await must(tb)];
    const losing = rows[0]?.supersededReason === "discarded" ? ta : tb;
    expect(rows.map((r) => r.supersededReason).sort()).toEqual(["discarded", null].sort());
    api.clock.set(t.add({ seconds: 30 }).toString());

    const again = await refresh(losing);

    expect(again.status).toBe(200);
    await expectLiveAndQuiet(s.sessionId, s.user.id);
  });
});

describe("TP-3.18: refresh.session", () => {
  it("TP-3.18: 31 refreshes of one session within 10 minutes, each with the current token → the 31st is RATE_LIMITED", async () => {
    const s = await newSession();
    let token = s.t1;
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const res = await refresh(token);
      statuses.push(res.status);
      if (res.status === 200) token = tokensOf(res).refreshToken;
    }

    const last = await refresh(token);

    expect(statuses).toEqual(Array.from({ length: 30 }, () => 200));
    expect(last.status).toBe(429);
    expect(errorOf(last).code).toBe("RATE_LIMITED");
    expect(last.headers["retry-after"]).toBeDefined();
  });

  it("TP-3.18x: another session of the same user isn't limited by the first one's refreshes", async () => {
    const s = await newSession();
    let token = s.t1;
    for (let i = 0; i < 31; i += 1) {
      const res = await refresh(token);
      if (res.status === 200) token = tokensOf(res).refreshToken;
    }
    const other = await sessionFactory(h, { userId: s.user.id, now: NOW });

    expect((await refresh(other.refreshToken)).status).toBe(200);
  });

  it("TP-3.18x: 121 refreshes from one IP within 10 minutes → the 121st is RATE_LIMITED (refresh.ip)", async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 120; i += 1)
      statuses.push((await refresh(generateToken("refresh"), ip)).status);

    const last = await refresh(generateToken("refresh"), ip);

    expect(statuses).toEqual(Array.from({ length: 120 }, () => 401));
    expect(last.status).toBe(429);
    expect(errorOf(last).code).toBe("RATE_LIMITED");
  }, 60_000);
});
