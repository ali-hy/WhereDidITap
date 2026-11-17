// auth.signOut (F-53) and me.listSessions, me.revokeSession, me.revokeOtherSessions (F-54) through
// the real HTTP layer (identity LLD §4.4, §5.2, §5.3). TP-3.19, TP-3.20, plus extra cases ending in
// "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { sessionFactory, userFactory, type FactorySession } from "../../factories/identity.js";
import {
  buildIdentityApi,
  cookieHeader,
  setCookies,
  T0,
  type IdentityApi,
} from "../../support/identity.js";
import { call, errorOf } from "../../support/identityHttp.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const wire = (i: Temporal.Instant): string => i.toString({ fractionalSecondDigits: 3 });
const ms = (d: unknown): number | null => (d === null ? null : (d as Date).getTime());

beforeAll(async () => {
  api = await buildIdentityApi();
  h = api.testDb.database.handle;
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
  api.clock.set(T0);
});

/** Headers for a cookie session (web client) or a bearer session (Android client). */
const as = (s: FactorySession, delivery: "cookie" | "bearer" = "bearer") =>
  delivery === "cookie"
    ? {
        client: "web/1",
        headers: { cookie: cookieHeader({ "__Secure-budmon_at": s.accessToken }) },
      }
    : { headers: { authorization: `Bearer ${s.accessToken}` } };

async function sessionRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await h.executeSql("SELECT * FROM sessions WHERE id = $1", [id]);
  if (rows[0] === undefined) throw new Error("no session row");
  return rows[0];
}

const eventKinds = async (userId: string): Promise<string[]> =>
  (
    await h.executeSql(
      "SELECT kind FROM security_events WHERE user_id = $1 ORDER BY created_at, id",
      [userId],
    )
  ).rows.map((r) => r["kind"] as string);

describe("TP-3.19: signing out", () => {
  it("TP-3.19: a cookie session signs out → { ok: true }, the access, refresh and challenge cookies cleared (never the device cookie), the session revoked sign_out; a second sign-out and me.get → 401 UNAUTHENTICATED", async () => {
    const user = await userFactory(h);
    const s = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      delivery: "cookie",
      clientKind: "web",
    });

    const first = await call(api.app, "POST", "/auth/sign-out", {}, as(s, "cookie"));
    const second = await call(api.app, "POST", "/auth/sign-out", {}, as(s, "cookie"));
    const me = await call(api.app, "GET", "/me", undefined, as(s, "cookie"));

    expect(first.status).toBe(200);
    expect(first.json()).toEqual({ ok: true });
    const cleared = setCookies(first);
    expect(cleared).toHaveLength(3);
    expect(cleared).toEqual(
      expect.arrayContaining([
        "__Secure-budmon_at=; Path=/api/v1; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
        "__Secure-budmon_rt=; Path=/api/v1/auth/refresh; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
        "__Secure-budmon_2fa=; Path=/api/v1/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
      ]) as unknown,
    );
    expect(cleared.some((c) => c.includes("budmon_dv"))).toBe(false);
    const row = await sessionRow(s.sessionId);
    expect(row["revoke_reason"]).toBe("sign_out");
    expect(ms(row["revoked_at"])).toBe(NOW.epochMilliseconds);
    expect(second.status).toBe(401);
    expect(errorOf(second).code).toBe("UNAUTHENTICATED");
    expect(me.status).toBe(401);
    expect(errorOf(me).code).toBe("UNAUTHENTICATED");
  });

  it("TP-3.19x: a bearer session signs out → { ok: true }; its refresh token no longer refreshes", async () => {
    const user = await userFactory(h);
    const s = await sessionFactory(h, { userId: user.id, now: NOW });

    const res = await call(api.app, "POST", "/auth/sign-out", {}, as(s));
    const refresh = await call(api.app, "POST", "/auth/refresh", {
      tokenDelivery: "body",
      refreshToken: s.refreshToken,
    });

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect((await sessionRow(s.sessionId))["revoke_reason"]).toBe("sign_out");
    expect(errorOf(refresh).code).toBe("REFRESH_INVALID");
  });

  it("TP-3.19x: signing out leaves the user's other sessions live", async () => {
    const user = await userFactory(h);
    const s = await sessionFactory(h, { userId: user.id, now: NOW });
    const other = await sessionFactory(h, { userId: user.id, now: NOW });

    const res = await call(api.app, "POST", "/auth/sign-out", {}, as(s));

    expect(res.status).toBe(200);
    expect((await sessionRow(s.sessionId))["revoke_reason"]).toBe("sign_out");
    expect((await sessionRow(other.sessionId))["revoked_at"]).toBeNull();
  });
});

describe("TP-3.20: listing and revoking sessions", () => {
  /** User A: the current session (least recently used of three), s2 (web, most recent), s3; user B's one. */
  async function fixture() {
    const a = await userFactory(h);
    const b = await userFactory(h);
    const current = await sessionFactory(h, {
      userId: a.id,
      now: NOW,
      lastUsedAt: NOW.subtract({ hours: 3 }),
    });
    const s2 = await sessionFactory(h, {
      userId: a.id,
      now: NOW,
      delivery: "cookie",
      clientKind: "web",
      lastUsedAt: NOW.subtract({ hours: 1 }),
    });
    const s3 = await sessionFactory(h, {
      userId: a.id,
      now: NOW,
      lastUsedAt: NOW.subtract({ hours: 2 }),
    });
    const bs = await sessionFactory(h, { userId: b.id, now: NOW });
    return { a, b, current, s2, s3, bs };
  }

  const item = async (s: FactorySession, current: boolean) => {
    const row = await sessionRow(s.sessionId);
    return {
      id: s.sessionId,
      deviceLabel: row["device_label"],
      clientKind: row["client_kind"],
      createdAt: (row["created_at"] as Date).toISOString(),
      lastUsedAt: (row["last_used_at"] as Date).toISOString(),
      current,
    };
  };

  const revoke = (s: FactorySession, sessionId: string) =>
    call(api.app, "POST", "/me/sessions/revoke", { sessionId }, as(s));

  it("TP-3.20: the list has the current session first, then the others by lastUsedAt descending", async () => {
    const f = await fixture();

    const res = await call(api.app, "GET", "/me/sessions", undefined, as(f.current));

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      items: [await item(f.current, true), await item(f.s2, false), await item(f.s3, false)],
    });
    expect((await item(f.s2, false)).lastUsedAt).toBe(wire(NOW.subtract({ hours: 1 })));
  });

  it("TP-3.20: revoking user B's session → 404 NOT_FOUND; B's session stays live", async () => {
    const f = await fixture();

    const res = await revoke(f.current, f.bs.sessionId);

    expect(res.status).toBe(404);
    expect(errorOf(res)).toEqual({
      defined: true,
      code: "NOT_FOUND",
      status: 404,
      message: "Not found",
    });
    expect((await sessionRow(f.bs.sessionId))["revoked_at"]).toBeNull();
  });

  it("TP-3.20: revoking the current session → 409 CONFLICT { reason: current_session }; it stays live", async () => {
    const f = await fixture();

    const res = await revoke(f.current, f.current.sessionId);

    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual({
      defined: true,
      code: "CONFLICT",
      status: 409,
      message: "Conflict",
      data: { reason: "current_session" },
    });
    expect((await sessionRow(f.current.sessionId))["revoked_at"]).toBeNull();
  });

  it("TP-3.20: revoking another own session → { ok: true }, revoked revoked_by_user, event session_revoked; then revoke others → { revoked: 1 } and the list holds only the current one", async () => {
    const f = await fixture();

    const one = await revoke(f.current, f.s2.sessionId);
    const others = await call(api.app, "POST", "/me/sessions/revoke-others", {}, as(f.current));
    const list = await call(api.app, "GET", "/me/sessions", undefined, as(f.current));

    expect(one.status).toBe(200);
    expect(one.json()).toEqual({ ok: true });
    const s2 = await sessionRow(f.s2.sessionId);
    expect(s2["revoke_reason"]).toBe("revoked_by_user");
    expect(ms(s2["revoked_at"])).toBe(NOW.epochMilliseconds);
    expect(others.status).toBe(200);
    expect(others.json()).toEqual({ revoked: 1 });
    expect((await sessionRow(f.s3.sessionId))["revoke_reason"]).toBe("other_devices");
    expect((await sessionRow(f.current.sessionId))["revoked_at"]).toBeNull();
    expect((await sessionRow(f.bs.sessionId))["revoked_at"]).toBeNull();
    expect(await eventKinds(f.a.id)).toEqual(["session_revoked", "session_revoked"]);
    expect(list.json()).toEqual({ items: [await item(f.current, true)] });
  });

  it("TP-3.20x: revoking an already revoked own session → 404 NOT_FOUND, no second event", async () => {
    const f = await fixture();
    await revoke(f.current, f.s2.sessionId);

    const again = await revoke(f.current, f.s2.sessionId);

    expect(again.status).toBe(404);
    expect(errorOf(again).code).toBe("NOT_FOUND");
    expect(await eventKinds(f.a.id)).toEqual(["session_revoked"]);
  });

  it("TP-3.20x: revoking an unknown session ID → 404 NOT_FOUND", async () => {
    const f = await fixture();

    const res = await revoke(f.current, "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a77");

    expect(errorOf(res).code).toBe("NOT_FOUND");
  });

  it("TP-3.20x: revoked and idle-expired sessions aren't listed", async () => {
    const f = await fixture();
    await sessionFactory(h, {
      userId: f.a.id,
      now: NOW,
      revoked: { reason: "sign_out", at: NOW.subtract({ minutes: 5 }) },
    });
    await sessionFactory(h, {
      userId: f.a.id,
      now: NOW,
      idleExpiresAt: NOW.subtract({ milliseconds: 1 }),
    });

    const res = await call(api.app, "GET", "/me/sessions", undefined, as(f.current));

    expect((res.json() as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([
      f.current.sessionId,
      f.s2.sessionId,
      f.s3.sessionId,
    ]);
  });

  it("TP-3.20x (A-73): a session whose idle expiry is exactly now isn't listed; one 1 ms later is", async () => {
    const a = await userFactory(h);
    const current = await sessionFactory(h, { userId: a.id, now: NOW });
    const atNow = await sessionFactory(h, {
      userId: a.id,
      now: NOW,
      lastUsedAt: NOW.subtract({ hours: 1 }),
      idleExpiresAt: NOW,
    });
    const later = await sessionFactory(h, {
      userId: a.id,
      now: NOW,
      lastUsedAt: NOW.subtract({ hours: 2 }),
      idleExpiresAt: NOW.add({ milliseconds: 1 }),
    });

    const res = await call(api.app, "GET", "/me/sessions", undefined, as(current));

    expect(res.status).toBe(200);
    const listed = (res.json() as { items: { id: string }[] }).items.map((i) => i.id);
    expect(listed).toEqual([current.sessionId, later.sessionId]);
    expect(listed).not.toContain(atNow.sessionId);
  });

  it("TP-3.20x (A-73): revoke others with no other live session → { revoked: 0 } and no session_revoked event", async () => {
    const a = await userFactory(h);
    const current = await sessionFactory(h, { userId: a.id, now: NOW });

    const res = await call(api.app, "POST", "/me/sessions/revoke-others", {}, as(current));

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ revoked: 0 });
    expect(await eventKinds(a.id)).toEqual([]);
    expect((await sessionRow(current.sessionId))["revoked_at"]).toBeNull();
  });

  it("TP-3.20x: a revoked session can't use the API any more (the hook refuses its access token)", async () => {
    const f = await fixture();
    await revoke(f.current, f.s2.sessionId);

    const res = await call(api.app, "GET", "/me", undefined, as(f.s2, "cookie"));

    expect(res.status).toBe(401);
  });
});
