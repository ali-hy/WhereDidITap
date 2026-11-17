// auth.signIn (F-50, F-51 through F-23) and the login-CSRF guard (F-36) through the real HTTP layer
// (identity LLD §4.4, §5.2, §6). TP-3.1 to TP-3.7, TP-3.26 (signIn and refresh), TP-3.28 (I), plus
// extra cases ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { hash as argon2Hash } from "@node-rs/argon2";
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import * as credentialsRepo from "../../../src/identity/credentialsRepo.js";
import { createPasswordHasher, type PasswordHasher } from "../../../src/identity/passwordHasher.js";
import { hashToken } from "../../../src/identity/tokens.js";
import {
  banFactory,
  FACTORY_PASSWORD,
  googleIdentityFactory,
  knownDeviceFactory,
  passwordFactory,
  sessionFactory,
  twoStepFactory,
  userFactory,
} from "../../factories/identity.js";
import {
  buildIdentityApi,
  cookieHeader,
  cookieJar,
  setCookies,
  T0,
  type IdentityApi,
} from "../../support/identity.js";
import { call, errorOf, nextIp, type CallOptions } from "../../support/identityHttp.js";
import { jobRows } from "../../support/jobs.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const WRONG = "not the right password";
const wire = (i: Temporal.Instant): string => i.toString({ fractionalSecondDigits: 3 });
const days = (n: number) => ({ hours: 24 * n });
const TOKEN = (prefix: string) => new RegExp(`^${prefix}_[A-Za-z0-9_-]{43}$`);

/** F-39's hasher with `verify` recorded (the PHC each call got). */
const realHasher = createPasswordHasher();
const verifyCalls: (string | null)[] = [];
const spyHasher: PasswordHasher = {
  hash: (p) => realHasher.hash(p),
  verify: (phc, p) => {
    verifyCalls.push(phc);
    return realHasher.verify(phc, p);
  },
  needsRehash: (phc) => realHasher.needsRehash(phc),
};

beforeAll(async () => {
  api = await buildIdentityApi({ identityOverrides: { hasher: spyHasher } });
  await api.container.boss.start();
  h = api.testDb.database.handle;
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
  api.clock.set(T0);
  verifyCalls.length = 0;
});

interface SignInBody {
  email: string;
  password: string;
  tokenDelivery: "cookie" | "body";
  deviceToken?: string;
  deviceModel?: string;
}

/** auth.signIn; cookie delivery sends the web client header unless `opts.client` says otherwise. */
const signIn = (body: SignInBody, opts: CallOptions = {}) =>
  call(api.app, "POST", "/auth/sign-in", body, {
    client: body.tokenDelivery === "cookie" ? "web/1" : "android/1",
    ...opts,
  });

const passwordUser = async (overrides: Parameters<typeof userFactory>[1] = {}) => {
  const user = await userFactory(h, overrides);
  await passwordFactory(h, user.id);
  return user;
};

const eventKinds = async (userId: string): Promise<string[]> =>
  (
    await h.executeSql(
      "SELECT kind FROM security_events WHERE user_id = $1 ORDER BY created_at, id",
      [userId],
    )
  ).rows.map((r) => r["kind"] as string);

const sessionsOf = async (userId: string) =>
  (
    await h.executeSql(
      "SELECT id, auth_method, delivery, client_kind, revoked_at, revoke_reason, access_token_hash FROM sessions WHERE user_id = $1 ORDER BY created_at, id",
      [userId],
    )
  ).rows;

const emailJobsFor = async (refId: string) =>
  (await jobRows(api.testDb.database, "identity.email-send"))
    .map((r) => r.data as Record<string, unknown>)
    .filter((d) => d["refId"] === refId);

/** Hits counted on `limiter` (F-29 names prefix the platform's bucket keys). */
const limiterHits = async (limiter: string): Promise<number> =>
  (
    await h.executeSql(
      "SELECT coalesce(sum(hits), 0)::int AS n FROM rate_limit_counters WHERE bucket_key LIKE $1",
      [`${limiter}:%`],
    )
  ).rows[0]?.["n"] as number;

const meWithBearer = (accessToken: string) =>
  call(api.app, "GET", "/me", undefined, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

interface TokensWire {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  deviceToken: string | null;
}

describe("TP-3.1: signing in with a password", () => {
  it("TP-3.1: body delivery → signed_in with the tokens in the body, a new device token and recoveryCodesLeft null; a bearer password session; event sign_in_succeeded", async () => {
    const user = await passwordUser();

    const res = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
    });

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      status: "signed_in",
      tokens: {
        accessToken: expect.stringMatching(TOKEN("bma")) as unknown,
        refreshToken: expect.stringMatching(TOKEN("bmr")) as unknown,
        accessExpiresAt: wire(NOW.add({ minutes: 15 })),
        refreshExpiresAt: wire(NOW.add(days(30))),
        deviceToken: expect.stringMatching(TOKEN("bmd")) as unknown,
      },
      recoveryCodesLeft: null,
    });
    expect(setCookies(res)).toEqual([]);
    const tokens = (res.json() as { tokens: TokensWire }).tokens;
    const sessions = await sessionsOf(user.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      auth_method: "password",
      delivery: "bearer",
      client_kind: "android",
      revoked_at: null,
    });
    expect(
      (sessions[0]?.["access_token_hash"] as Buffer).equals(hashToken(tokens.accessToken)),
    ).toBe(true);
    expect(await eventKinds(user.id)).toEqual(["sign_in_succeeded"]);
    const me = await meWithBearer(tokens.accessToken);
    expect(me.status).toBe(200);
    expect(me.json()).toMatchObject({ id: user.id, sessionId: sessions[0]?.["id"] });
  });

  it("TP-3.1: cookie delivery (X-Budmon-Client web/1) → tokens null; access, refresh and device cookies set, the challenge cookie cleared; a cookie web session", async () => {
    const user = await passwordUser();

    const res = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "cookie",
    });

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ status: "signed_in", tokens: null, recoveryCodesLeft: null });
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(4);
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^__Secure-budmon_at=bma_[A-Za-z0-9_-]{43}; Path=\/api\/v1; Max-Age=900; HttpOnly; Secure; SameSite=Strict$/,
        ),
        expect.stringMatching(
          /^__Secure-budmon_rt=bmr_[A-Za-z0-9_-]{43}; Path=\/api\/v1\/auth\/refresh; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict$/,
        ),
        expect.stringMatching(
          /^__Secure-budmon_dv=bmd_[A-Za-z0-9_-]{43}; Path=\/api\/v1; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict$/,
        ),
        "__Secure-budmon_2fa=; Path=/api/v1/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
      ]) as unknown,
    );
    const sessions = await sessionsOf(user.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      auth_method: "password",
      delivery: "cookie",
      client_kind: "web",
    });
    expect(await eventKinds(user.id)).toEqual(["sign_in_succeeded"]);
    const jar = cookieJar(res);
    const me = await call(api.app, "GET", "/me", undefined, {
      client: "web/1",
      headers: { cookie: cookieHeader({ "__Secure-budmon_at": jar["__Secure-budmon_at"] ?? "" }) },
    });
    expect(me.status).toBe(200);
    expect(me.json()).toMatchObject({ id: user.id });
  });

  it("TP-3.1x: the email is normalised (spaces trimmed, case folded) before the lookup", async () => {
    const user = await passwordUser();

    const res = await signIn({
      email: `  ${user.email.toUpperCase()} `,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
    });

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ status: "signed_in" });
  });

  it("TP-3.1x: presenting the device token the first sign-in returned → deviceToken null the second time (F-23 step 4)", async () => {
    const user = await passwordUser();
    const first = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
    });
    const deviceToken = (first.json() as { tokens: TokensWire }).tokens.deviceToken ?? "";

    const second = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
      deviceToken,
    });

    expect(second.status).toBe(200);
    expect((second.json() as { tokens: TokensWire }).tokens.deviceToken).toBeNull();
  });
});

describe("TP-3.2: wrong credentials cost the same and say the same", () => {
  const INVALID = {
    defined: true,
    code: "INVALID_CREDENTIALS",
    status: 401,
    message: "Invalid credentials",
  };

  it("TP-3.2: a wrong password → 401 INVALID_CREDENTIALS; verify called once with the stored hash; event sign_in_failed (no email job); no session", async () => {
    const user = await passwordUser();
    const stored = await credentialsRepo.getPasswordHash(h, user.id);

    const res = await signIn({ email: user.email, password: WRONG, tokenDelivery: "body" });

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(INVALID);
    expect(verifyCalls).toEqual([stored?.hash]);
    expect(await eventKinds(user.id)).toEqual(["sign_in_failed"]);
    expect(await emailJobsFor(user.id)).toEqual([]);
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("TP-3.2: an unknown email → 401 INVALID_CREDENTIALS; verify called once against the dummy (null hash); no event at all", async () => {
    const res = await signIn({
      email: "nobody-here@example.invalid",
      password: WRONG,
      tokenDelivery: "body",
    });

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(INVALID);
    expect(verifyCalls).toEqual([null]);
    const events = await h.executeSql("SELECT count(*)::int AS n FROM security_events");
    expect(events.rows[0]?.["n"]).toBe(0);
  });

  it("TP-3.2: a Google-only user (no password) → 401 INVALID_CREDENTIALS; verify called once against the dummy; event sign_in_failed", async () => {
    const user = await userFactory(h);
    await googleIdentityFactory(h, { userId: user.id, email: user.email, now: NOW });

    const res = await signIn({ email: user.email, password: WRONG, tokenDelivery: "body" });

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(INVALID);
    expect(verifyCalls).toEqual([null]);
    expect(await eventKinds(user.id)).toEqual(["sign_in_failed"]);
    expect(await sessionsOf(user.id)).toEqual([]);
  });
});

describe("TP-3.3: closed accounts", () => {
  const pendingBy = (by: "self" | "owner" | "ban") => ({
    status: "pending_deletion" as const,
    deletionRequestedAt: new Date(NOW.epochMilliseconds),
    deletionScheduledFor: new Date(NOW.add(days(7)).epochMilliseconds),
    deletionRequestedBy: by,
  });
  const CLOSED = { defined: true, code: "ACCOUNT_CLOSED", status: 403, message: "Account closed" };

  it("TP-3.3: owner-pending deletion with the right password → 403 ACCOUNT_CLOSED, no session", async () => {
    const user = await passwordUser(pendingBy("owner"));

    const res = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
    });

    expect(res.status).toBe(403);
    expect(errorOf(res)).toEqual(CLOSED);
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("TP-3.3: a banned email with the right password → 403 ACCOUNT_CLOSED, no session", async () => {
    const user = await passwordUser();
    await banFactory(h, { email: user.email, now: NOW });

    const res = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
    });

    expect(res.status).toBe(403);
    expect(errorOf(res)).toEqual(CLOSED);
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("TP-3.3: self-pending deletion with the right password → signed_in", async () => {
    const user = await passwordUser(pendingBy("self"));

    const res = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
    });

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ status: "signed_in" });
  });

  it("TP-3.3: owner-pending deletion with a wrong password → 401 INVALID_CREDENTIALS (closure isn't revealed)", async () => {
    const user = await passwordUser(pendingBy("owner"));

    const res = await signIn({ email: user.email, password: WRONG, tokenDelivery: "body" });

    expect(res.status).toBe(401);
    expect(errorOf(res).code).toBe("INVALID_CREDENTIALS");
  });

  it("TP-3.3x: pending deletion requested by a ban, with the right password → 403 ACCOUNT_CLOSED", async () => {
    const user = await passwordUser(pendingBy("ban"));

    const res = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
    });

    expect(errorOf(res)).toEqual(CLOSED);
  });
});

describe("TP-3.4: LD-1 sign-in limits", () => {
  it("TP-3.4: 10 wrong from IP1 then an 11th → RATE_LIMITED; IPs 2 and 3 bring the unknown-device count to 30 and the 31st is RATE_LIMITED; the known device still signs in; another user's device token counts as unknown", async () => {
    const user = await passwordUser();
    const device = await knownDeviceFactory(h, { userId: user.id, now: NOW });
    const other = await passwordUser();
    const othersDevice = await knownDeviceFactory(h, { userId: other.id, now: NOW });
    const wrong = (ip: string) =>
      signIn({ email: user.email, password: WRONG, tokenDelivery: "body" }, { ip });

    const ip1 = nextIp();
    const fromIp1: number[] = [];
    for (let i = 0; i < 10; i += 1) fromIp1.push((await wrong(ip1)).status);
    const eleventh = await wrong(ip1);
    const fromIps2And3: number[] = [];
    for (const ip of [nextIp(), nextIp()]) {
      for (let i = 0; i < 10; i += 1) fromIps2And3.push((await wrong(ip)).status);
    }
    const thirtyFirst = await wrong(nextIp());
    const withDevice = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
      deviceToken: device.token,
    });
    const withOthersDevice = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
      deviceToken: othersDevice.token,
    });

    expect(fromIp1).toEqual(Array.from({ length: 10 }, () => 401));
    expect(eleventh.status).toBe(429);
    expect(errorOf(eleventh).code).toBe("RATE_LIMITED");
    expect(eleventh.headers["retry-after"]).toBeDefined();
    expect(fromIps2And3).toEqual(Array.from({ length: 20 }, () => 401));
    expect(thirtyFirst.status).toBe(429);
    expect(errorOf(thirtyFirst).code).toBe("RATE_LIMITED");
    expect(withDevice.status).toBe(200);
    expect(withDevice.json()).toMatchObject({ status: "signed_in" });
    expect(withOthersDevice.status).toBe(429);
    expect(errorOf(withOthersDevice).code).toBe("RATE_LIMITED");
  }, 60_000);

  it("TP-3.4x: 31 sign-ins from one IP within 10 minutes (different emails) → the 31st is RATE_LIMITED (signin.ip)", async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const res = await signIn(
        { email: `stranger-${String(i)}@example.invalid`, password: WRONG, tokenDelivery: "body" },
        { ip },
      );
      statuses.push(res.status);
    }

    const last = await signIn(
      { email: "stranger-31@example.invalid", password: WRONG, tokenDelivery: "body" },
      { ip },
    );

    expect(statuses).toEqual(Array.from({ length: 30 }, () => 401));
    expect(last.status).toBe(429);
    expect(errorOf(last).code).toBe("RATE_LIMITED");
  }, 60_000);
});

describe("TP-3.5: rehash on a parameter change", () => {
  it("TP-3.5: a stored hash with m=4096 is upgraded to m=19456,t=2,p=1 at sign-in, and the new one verifies", async () => {
    const user = await userFactory(h);
    const old = await argon2Hash(FACTORY_PASSWORD, {
      memoryCost: 4096,
      timeCost: 2,
      parallelism: 1,
    });
    await passwordFactory(h, user.id, old);
    expect(old).toMatch(/^\$argon2id\$v=19\$m=4096,t=2,p=1\$/);

    const res = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
    });

    expect(res.status).toBe(200);
    const stored = (await credentialsRepo.getPasswordHash(h, user.id))?.hash ?? "";
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await realHasher.verify(stored, FACTORY_PASSWORD)).toBe(true);
  });

  it("TP-3.5x: a hash already at the current parameters is left unchanged", async () => {
    const user = await passwordUser();
    const before = (await credentialsRepo.getPasswordHash(h, user.id))?.hash;

    await signIn({ email: user.email, password: FACTORY_PASSWORD, tokenDelivery: "body" });

    expect((await credentialsRepo.getPasswordHash(h, user.id))?.hash).toBe(before);
  });
});

describe("TP-3.6: two-step required hands back a challenge", () => {
  const challengesOf = async (userId: string) =>
    (
      await h.executeSql(
        "SELECT kind, token_hash, expires_at, consumed_at, attempts, data FROM auth_challenges WHERE user_id = $1",
        [userId],
      )
    ).rows;

  async function twoStepUser() {
    const user = await passwordUser();
    const apiSecrets = api.container.identity.deps.apiSecrets;
    if (apiSecrets === null) throw new Error("the API has no apiSecrets");
    await twoStepFactory(h, apiSecrets, { userId: user.id, now: NOW });
    return user;
  }

  it("TP-3.6: cookie delivery → two_step_required with challengeToken null and expiresAt now + 5 min; only the budmon_2fa cookie is set; a two_step challenge row; no session", async () => {
    const user = await twoStepUser();

    const res = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "cookie",
    });

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      status: "two_step_required",
      challengeToken: null,
      expiresAt: wire(NOW.add({ minutes: 5 })),
    });
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(
      /^__Secure-budmon_2fa=bmc_[A-Za-z0-9_-]{43}; Path=\/api\/v1\/auth; Max-Age=300; HttpOnly; Secure; SameSite=Strict$/,
    );
    const token = cookieJar(res)["__Secure-budmon_2fa"] ?? "";
    const rows = await challengesOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "two_step", consumed_at: null, attempts: 0 });
    expect((rows[0]?.["expires_at"] as Date).getTime()).toBe(
      NOW.add({ minutes: 5 }).epochMilliseconds,
    );
    expect((rows[0]?.["token_hash"] as Buffer).equals(hashToken(token))).toBe(true);
    expect(rows[0]?.["data"]).toMatchObject({
      delivery: "cookie",
      method: "password",
      pendingLink: null,
      clientKind: "web",
    });
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("TP-3.6: body delivery → two_step_required with the challengeToken in the body and no cookie; the row's hash matches it", async () => {
    const user = await twoStepUser();

    const res = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
    });

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      status: "two_step_required",
      challengeToken: expect.stringMatching(TOKEN("bmc")) as unknown,
      expiresAt: wire(NOW.add({ minutes: 5 })),
    });
    expect(setCookies(res)).toEqual([]);
    const token = (res.json() as { challengeToken: string }).challengeToken;
    const rows = await challengesOf(user.id);
    expect(rows).toHaveLength(1);
    expect((rows[0]?.["token_hash"] as Buffer).equals(hashToken(token))).toBe(true);
    expect(rows[0]?.["data"]).toMatchObject({
      delivery: "bearer",
      method: "password",
      pendingLink: null,
      clientKind: "android",
    });
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("TP-3.6x: a wrong password for a two-step user → INVALID_CREDENTIALS and no challenge", async () => {
    const user = await twoStepUser();

    const res = await signIn({ email: user.email, password: WRONG, tokenDelivery: "body" });

    expect(errorOf(res).code).toBe("INVALID_CREDENTIALS");
    expect(await challengesOf(user.id)).toEqual([]);
  });
});

describe("TP-3.7: the session limit at sign-in", () => {
  it("TP-3.7: with 20 live sessions, signing in revokes the least recently used one (limit) and 20 stay live", async () => {
    const user = await passwordUser();
    const existing = [];
    for (let i = 0; i < 20; i += 1) {
      existing.push(
        await sessionFactory(h, {
          userId: user.id,
          now: NOW,
          lastUsedAt: NOW.subtract(days(1)).add({ minutes: i }),
        }),
      );
    }

    const res = await signIn({
      email: user.email,
      password: FACTORY_PASSWORD,
      tokenDelivery: "body",
    });

    expect(res.status).toBe(200);
    const sessions = await sessionsOf(user.id);
    expect(sessions.filter((s) => s["revoked_at"] === null)).toHaveLength(20);
    const revoked = sessions.filter((s) => s["revoked_at"] !== null);
    expect(revoked.map((s) => ({ id: s["id"], reason: s["revoke_reason"] }))).toEqual([
      { id: existing[0]?.sessionId, reason: "limit" },
    ]);
  });
});

describe("TP-3.26: login CSRF on the cookie-setting public procedures", () => {
  const FORBIDDEN = { defined: true, code: "FORBIDDEN", status: 403, message: "Forbidden" };

  it("TP-3.26: auth.signIn with tokenDelivery cookie and no web client header → 403 FORBIDDEN, no session", async () => {
    const user = await passwordUser();

    const res = await signIn(
      { email: user.email, password: FACTORY_PASSWORD, tokenDelivery: "cookie" },
      { client: "android/1" },
    );

    expect(res.status).toBe(403);
    expect(errorOf(res)).toEqual(FORBIDDEN);
    expect(setCookies(res)).toEqual([]);
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("TP-3.26: auth.refresh with tokenDelivery cookie and no web client header → 403 FORBIDDEN; the token isn't rotated", async () => {
    const user = await userFactory(h);
    const session = await sessionFactory(h, {
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
        client: "android/1",
        headers: { cookie: cookieHeader({ "__Secure-budmon_rt": session.refreshToken }) },
      },
    );

    expect(res.status).toBe(403);
    expect(errorOf(res)).toEqual(FORBIDDEN);
    const { rows } = await h.executeSql(
      "SELECT count(*)::int AS n FROM session_refresh_tokens WHERE session_id = $1",
      [session.sessionId],
    );
    expect(rows[0]?.["n"]).toBe(1);
  });
});

describe("TP-3.28 (I): the web device cookie (P-9)", () => {
  /** Signs in once on a "browser" (cookie delivery) and returns its device cookie. */
  async function browserDeviceCookie(email: string): Promise<{ value: string; setCookie: string }> {
    const res = await signIn({ email, password: FACTORY_PASSWORD, tokenDelivery: "cookie" });
    expect(res.status).toBe(200);
    const setCookie = setCookies(res).find((c) => c.startsWith("__Secure-budmon_dv=")) ?? "";
    return { value: cookieJar(res)["__Secure-budmon_dv"] ?? "", setCookie };
  }

  it("TP-3.28: once the unknown-device bucket is exhausted, U's own device cookie still signs in (counted on signin.email-device); another user's device cookie is RATE_LIMITED", async () => {
    const u = await passwordUser();
    const v = await passwordUser();
    const uCookie = await browserDeviceCookie(u.email);
    const vCookie = await browserDeviceCookie(v.email);
    expect(uCookie.setCookie).toContain("; Path=/api/v1;");
    const wrong = (ip: string) =>
      signIn({ email: u.email, password: WRONG, tokenDelivery: "cookie" }, { ip });

    // The first sign-in counted once on signin.email-unknown-device (30 an hour), so 29 wrong
    // attempts without the cookie fit and the 30th is refused.
    const statuses: number[] = [];
    for (const ip of [nextIp(), nextIp(), nextIp()]) {
      for (let i = 0; i < 10; i += 1) statuses.push((await wrong(ip)).status);
    }
    const deviceHitsBefore = await limiterHits("signin.email-device");
    const withOwnCookie = await signIn(
      { email: u.email, password: FACTORY_PASSWORD, tokenDelivery: "cookie" },
      { headers: { cookie: cookieHeader({ "__Secure-budmon_dv": uCookie.value }) } },
    );
    const deviceHitsAfter = await limiterHits("signin.email-device");
    const withOthersCookie = await signIn(
      { email: u.email, password: FACTORY_PASSWORD, tokenDelivery: "cookie" },
      { headers: { cookie: cookieHeader({ "__Secure-budmon_dv": vCookie.value }) } },
    );

    expect(statuses.slice(0, 29)).toEqual(Array.from({ length: 29 }, () => 401));
    expect(statuses[29]).toBe(429);
    expect(withOwnCookie.status).toBe(200);
    expect(withOwnCookie.json()).toMatchObject({ status: "signed_in" });
    expect(deviceHitsAfter - deviceHitsBefore).toBe(1);
    expect(withOthersCookie.status).toBe(429);
    expect(errorOf(withOthersCookie).code).toBe("RATE_LIMITED");
  }, 60_000);

  it("TP-3.28x: a device cookie sent with body delivery is ignored: the body's deviceToken is the one read (F-36)", async () => {
    const user = await passwordUser();
    const browser = await browserDeviceCookie(user.email);

    const res = await signIn(
      { email: user.email, password: FACTORY_PASSWORD, tokenDelivery: "body" },
      { headers: { cookie: cookieHeader({ "__Secure-budmon_dv": browser.value }) } },
    );

    expect(res.status).toBe(200);
    expect((res.json() as { tokens: TokensWire }).tokens.deviceToken).toMatch(TOKEN("bmd"));
  });
});
