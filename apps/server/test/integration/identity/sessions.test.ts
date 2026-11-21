// F-23 createSession and F-26 revocation (identity LLD §4.1). TP-0.11, TP-0.13, plus extra cases
// TP-0.11x and TP-0.13x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../../src/platform/db/transaction.js";
import type { DbHandle } from "../../../src/platform/db/types.js";
import {
  createSession,
  revokeAllSessionsTx,
  revokeSessionTx,
} from "../../../src/identity/sessionService.js";
import type { IdentityDeps } from "../../../src/identity/identityModule.js";
import { hashToken, parseToken } from "../../../src/identity/tokens.js";
import { sessionFactory, userFactory } from "../../factories/identity.js";
import { buildIdentityApi, T0, type IdentityApi } from "../../support/identity.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let deps: IdentityDeps;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const ms = (i: Temporal.Instant): number => i.epochMilliseconds;

beforeAll(async () => {
  api = await buildIdentityApi();
  deps = api.container.identity.deps;
  h = api.testDb.database.handle;
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
  api.clock.set(T0);
});

const input = (userId: string, presentedDeviceToken: string | null = null) => ({
  userId,
  delivery: "bearer" as const,
  clientKind: "android" as const,
  deviceLabel: "Android · Pixel 8",
  authMethod: "password" as const,
  presentedDeviceToken,
});

async function sessionRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await h.executeSql("SELECT * FROM sessions WHERE id = $1", [id]);
  if (rows[0] === undefined) throw new Error("no session row");
  return rows[0];
}

async function liveCount(userId: string): Promise<number> {
  const { rows } = await h.executeSql(
    "SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
  return rows[0]?.["n"] as number;
}

describe("TP-0.11: createSession", () => {
  it("TP-0.11: a user with 20 live sessions: the 21st is created and the least recently used one is revoked with reason limit", async () => {
    const user = await userFactory(h);
    const existing = [];
    for (let i = 0; i < 20; i += 1) {
      // Session i was last used i minutes after T0 − 1 day, so session 0 is the least recent.
      existing.push(
        await sessionFactory(h, {
          userId: user.id,
          now: NOW,
          lastUsedAt: NOW.subtract({ hours: 24 }).add({ minutes: i }),
        }),
      );
    }

    const issued = await withTransaction(deps.database, (tx) =>
      createSession(deps, tx, input(user.id)),
    );

    expect(await liveCount(user.id)).toBe(20);
    const lru = await sessionRow(existing[0]?.sessionId ?? "");
    expect(lru["revoke_reason"]).toBe("limit");
    expect(ms(Temporal.Instant.fromEpochMilliseconds((lru["revoked_at"] as Date).getTime()))).toBe(
      ms(NOW),
    );
    for (const s of existing.slice(1))
      expect((await sessionRow(s.sessionId))["revoked_at"]).toBeNull();
    expect((await sessionRow(issued.sessionId))["revoked_at"]).toBeNull();
  });

  it("TP-0.11: expiries are exact (access now + 15 min, idle now + 30 d) on the row and in the result", async () => {
    const user = await userFactory(h);

    const issued = await withTransaction(deps.database, (tx) =>
      createSession(deps, tx, input(user.id)),
    );

    const row = await sessionRow(issued.sessionId);
    expect((row["access_expires_at"] as Date).getTime()).toBe(ms(NOW.add({ minutes: 15 })));
    expect((row["idle_expires_at"] as Date).getTime()).toBe(ms(NOW.add({ hours: 24 * 30 })));
    expect(ms(issued.accessExpiresAt)).toBe(ms(NOW.add({ minutes: 15 })));
    expect(ms(issued.refreshExpiresAt)).toBe(ms(NOW.add({ hours: 24 * 30 })));
  });

  it("TP-0.11: deviceToken is non-null without a device token, then null when the returned one is presented", async () => {
    const user = await userFactory(h);

    const first = await withTransaction(deps.database, (tx) =>
      createSession(deps, tx, input(user.id)),
    );
    const second = await withTransaction(deps.database, (tx) =>
      createSession(deps, tx, input(user.id, first.deviceToken)),
    );

    expect(first.deviceToken).not.toBeNull();
    expect(parseToken("device", first.deviceToken)).toBe(first.deviceToken);
    expect(second.deviceToken).toBeNull();
  });
});

describe("TP-0.11x: what createSession stores", () => {
  it("TP-0.11x: the row and its first refresh token match the returned tokens", async () => {
    const user = await userFactory(h);

    const issued = await withTransaction(deps.database, (tx) =>
      createSession(deps, tx, input(user.id)),
    );

    const row = await sessionRow(issued.sessionId);
    expect(issued.userId).toBe(user.id);
    expect(issued.delivery).toBe("bearer");
    expect(parseToken("access", issued.accessToken)).toBe(issued.accessToken);
    expect(parseToken("refresh", issued.refreshToken)).toBe(issued.refreshToken);
    expect((row["access_token_hash"] as Buffer).equals(hashToken(issued.accessToken))).toBe(true);
    expect(row).toMatchObject({
      user_id: user.id,
      delivery: "bearer",
      client_kind: "android",
      device_label: "Android · Pixel 8",
      auth_method: "password",
      revoke_reason: null,
    });
    expect((row["confirmed_at"] as Date).getTime()).toBe(ms(NOW));
    expect((row["last_used_at"] as Date).getTime()).toBe(ms(NOW));
    const { rows } = await h.executeSql(
      "SELECT * FROM session_refresh_tokens WHERE session_id = $1",
      [issued.sessionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: row["current_refresh_id"],
      parent_id: null,
      generation: 1,
    });
    expect((rows[0]?.["token_hash"] as Buffer).equals(hashToken(issued.refreshToken))).toBe(true);
    expect((rows[0]?.["issued_at"] as Date).getTime()).toBe(ms(NOW));
  });

  it("TP-0.11x: a new known device is stored for the user, hashed, expiring in 365 days", async () => {
    const user = await userFactory(h);

    const issued = await withTransaction(deps.database, (tx) =>
      createSession(deps, tx, input(user.id)),
    );

    const { rows } = await h.executeSql("SELECT * FROM known_devices WHERE user_id = $1", [
      user.id,
    ]);
    expect(rows).toHaveLength(1);
    expect((rows[0]?.["token_hash"] as Buffer).equals(hashToken(issued.deviceToken ?? ""))).toBe(
      true,
    );
    expect((rows[0]?.["expires_at"] as Date).getTime()).toBe(ms(NOW.add({ hours: 24 * 365 })));
  });

  it("TP-0.11x: another user's device token isn't accepted: a new one is issued", async () => {
    const owner = await userFactory(h);
    const other = await userFactory(h);
    const theirs = await withTransaction(deps.database, (tx) =>
      createSession(deps, tx, input(other.id)),
    );

    const mine = await withTransaction(deps.database, (tx) =>
      createSession(deps, tx, input(owner.id, theirs.deviceToken)),
    );

    expect(mine.deviceToken).not.toBeNull();
    expect(mine.deviceToken).not.toBe(theirs.deviceToken);
  });

  it("TP-0.11x: a malformed presented device token is ignored and a new one issued", async () => {
    const user = await userFactory(h);

    const issued = await withTransaction(deps.database, (tx) =>
      createSession(deps, tx, input(user.id, "bmd_short")),
    );

    expect(issued.deviceToken).not.toBeNull();
  });

  it("TP-0.11x: users.last_active_at is set to now", async () => {
    const user = await userFactory(h);

    await withTransaction(deps.database, (tx) => createSession(deps, tx, input(user.id)));

    const { rows } = await h.executeSql("SELECT last_active_at FROM users WHERE id = $1", [
      user.id,
    ]);
    expect((rows[0]?.["last_active_at"] as Date).getTime()).toBe(ms(NOW));
  });

  it("TP-0.11x: with 19 live sessions nothing is revoked (20 remain, including the new one)", async () => {
    const user = await userFactory(h);
    for (let i = 0; i < 19; i += 1) await sessionFactory(h, { userId: user.id, now: NOW });

    await withTransaction(deps.database, (tx) => createSession(deps, tx, input(user.id)));

    expect(await liveCount(user.id)).toBe(20);
    const { rows } = await h.executeSql(
      "SELECT count(*)::int AS n FROM sessions WHERE revoked_at IS NOT NULL",
    );
    expect(rows[0]?.["n"]).toBe(0);
  });

  it("TP-0.11x: created inside a transaction that rolls back, nothing remains", async () => {
    const user = await userFactory(h);

    await expect(
      withTransaction(deps.database, async (tx) => {
        await createSession(deps, tx, input(user.id));
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");

    const { rows } = await h.executeSql("SELECT count(*)::int AS n FROM sessions");
    expect(rows[0]?.["n"]).toBe(0);
  });
});

describe("TP-0.13: revocation", () => {
  it("TP-0.13: revokeAllSessionsTx except one revokes the other 2; revoking an already revoked one is false", async () => {
    const user = await userFactory(h);
    const [a, b, c] = [
      await sessionFactory(h, { userId: user.id, now: NOW }),
      await sessionFactory(h, { userId: user.id, now: NOW }),
      await sessionFactory(h, { userId: user.id, now: NOW }),
    ];

    const revoked = await withTransaction(deps.database, (tx) =>
      revokeAllSessionsTx(deps, tx, user.id, "other_devices", NOW, a.sessionId),
    );
    const again = await withTransaction(deps.database, (tx) =>
      revokeSessionTx(deps, tx, b.sessionId, "revoked_by_user", NOW),
    );

    expect(revoked).toBe(2);
    expect(again).toBe(false);
    expect((await sessionRow(a.sessionId))["revoked_at"]).toBeNull();
    expect((await sessionRow(b.sessionId))["revoke_reason"]).toBe("other_devices");
    expect((await sessionRow(c.sessionId))["revoke_reason"]).toBe("other_devices");
  });
});

describe("TP-0.13x: revocation details", () => {
  it("TP-0.13x: revokeSessionTx on a live session is true and stores the reason and time", async () => {
    const user = await userFactory(h);
    const s = await sessionFactory(h, { userId: user.id, now: NOW });
    const at = NOW.add({ minutes: 3 });

    const ok = await withTransaction(deps.database, (tx) =>
      revokeSessionTx(deps, tx, s.sessionId, "sign_out", at),
    );

    expect(ok).toBe(true);
    const row = await sessionRow(s.sessionId);
    expect(row["revoke_reason"]).toBe("sign_out");
    expect((row["revoked_at"] as Date).getTime()).toBe(ms(at));
  });

  it("TP-0.13x: revokeAllSessionsTx without an exception revokes every live session, not other users'", async () => {
    const user = await userFactory(h);
    const other = await userFactory(h);
    await sessionFactory(h, { userId: user.id, now: NOW });
    await sessionFactory(h, { userId: user.id, now: NOW });
    await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      revoked: { reason: "sign_out", at: NOW },
    });
    await sessionFactory(h, { userId: other.id, now: NOW });

    const n = await withTransaction(deps.database, (tx) =>
      revokeAllSessionsTx(deps, tx, user.id, "password_changed", NOW),
    );

    expect(n).toBe(2);
    expect(await liveCount(user.id)).toBe(0);
    expect(await liveCount(other.id)).toBe(1);
  });

  it("TP-0.13x: an already revoked session keeps its first reason", async () => {
    const user = await userFactory(h);
    const s = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      revoked: { reason: "sign_out", at: NOW },
    });

    await withTransaction(deps.database, (tx) =>
      revokeSessionTx(deps, tx, s.sessionId, "reuse_detected", NOW.add({ minutes: 1 })),
    );

    expect((await sessionRow(s.sessionId))["revoke_reason"]).toBe("sign_out");
  });
});
