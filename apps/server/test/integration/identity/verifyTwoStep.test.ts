// auth.verifyTwoStep (F-52 through F-62) through the real HTTP layer (identity LLD §4.4, §4.5,
// §5.2, §6, D-8). TP-4.7, TP-4.8, TP-4.9, TP-4.36, and TP-3.31 (moved from S-3, A-72), plus extra
// cases ending in "x".
// Codes come from test/support/totp.ts (RFC 6238, independent of F-60); the clock is fixed at T0,
// so step s = stepAt(T0) and codes for s − 1 to s + 1 are valid.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import * as usersRepo from "../../../src/identity/usersRepo.js";
import { banFactory, FACTORY_PASSWORD, sessionFactory } from "../../factories/identity.js";
import {
  buildIdentityApi,
  cookieHeader,
  cookieJar,
  setCookies,
  T0,
  type IdentityApi,
} from "../../support/identity.js";
import { call, errorOf, type CallOptions } from "../../support/identityHttp.js";
import { resetBetweenTests } from "../../support/testDatabase.js";
import { codeAt, stepAt, wrongCode } from "../../support/totp.js";
import {
  bearer,
  emailJobs,
  recoveryCodeRows,
  SECRET_BYTES,
  securityEvents,
  twoStepRow,
  twoStepUser,
} from "../../support/twoStep.js";

let api: IdentityApi;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const wire = (i: Temporal.Instant): string => i.toString({ fractionalSecondDigits: 3 });
const TOKEN = (prefix: string) => new RegExp(`^${prefix}_[A-Za-z0-9_-]{43}$`);
const CHALLENGE_COOKIE = "__Secure-budmon_2fa";

beforeAll(async () => {
  api = await buildIdentityApi();
  await api.container.boss.start();
  h = api.testDb.database.handle;
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
  api.clock.set(T0);
});

const CHALLENGE_EXPIRED = {
  defined: true,
  code: "TWO_STEP_CHALLENGE_EXPIRED",
  status: 401,
  message: "Two-step challenge expired",
};
const CODE_INVALID = {
  defined: true,
  code: "TWO_STEP_CODE_INVALID",
  status: 400,
  message: "Invalid two-step code",
};

type Factor = { code: string } | { recoveryCode: string };

/** auth.signIn with the factory password; returns the challenge token (body) or cookie value. */
async function challengeFor(email: string, delivery: "body" | "cookie" = "body"): Promise<string> {
  const res = await call(
    api.app,
    "POST",
    "/auth/sign-in",
    { email, password: FACTORY_PASSWORD, tokenDelivery: delivery },
    { client: delivery === "cookie" ? "web/1" : "android/1" },
  );
  expect(res.status).toBe(200);
  expect(res.json()).toMatchObject({ status: "two_step_required" });
  const token =
    delivery === "body"
      ? (res.json() as { challengeToken: string }).challengeToken
      : (cookieJar(res)[CHALLENGE_COOKIE] ?? "");
  expect(token).toMatch(TOKEN("bmc"));
  return token;
}

const verifyBody = (challengeToken: string, factor: Factor, opts: CallOptions = {}) =>
  call(
    api.app,
    "POST",
    "/auth/two-step/verify",
    { challengeToken, ...factor, tokenDelivery: "body" },
    opts,
  );

const verifyCookie = (cookie: string, factor: Factor, client = "web/1") =>
  call(
    api.app,
    "POST",
    "/auth/two-step/verify",
    { ...factor, tokenDelivery: "cookie" },
    { client, headers: { cookie: cookieHeader({ [CHALLENGE_COOKIE]: cookie }) } },
  );

const sessionsOf = async (userId: string) =>
  (
    await h.executeSql(
      "SELECT id, auth_method, delivery, client_kind, revoked_at FROM sessions WHERE user_id = $1 ORDER BY created_at, id",
      [userId],
    )
  ).rows;

const challengeRows = async (userId: string) =>
  (
    await h.executeSql(
      "SELECT consumed_at, attempts FROM auth_challenges WHERE user_id = $1 AND kind = 'two_step' ORDER BY created_at",
      [userId],
    )
  ).rows;

const kinds = async (userId: string): Promise<string[]> =>
  (await securityEvents(h, userId)).map((e) => e.kind).sort();

const now = (): Temporal.Instant => api.clock.now();

describe("TP-4.7: verifying a two-step challenge", () => {
  it("TP-4.7: the right code (body delivery) → signed_in with the tokens in the body and recoveryCodesLeft null; a password session; the challenge consumed; sign_in_succeeded; last_used_step s", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);

    const res = await verifyBody(challenge, { code: codeAt(SECRET_BYTES, NOW) });

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({
      status: "signed_in",
      recoveryCodesLeft: null,
      tokens: {
        accessToken: expect.stringMatching(TOKEN("bma")) as unknown,
        refreshToken: expect.stringMatching(TOKEN("bmr")) as unknown,
        accessExpiresAt: wire(NOW.add({ minutes: 15 })),
      },
    });
    expect(setCookies(res).filter((c) => /budmon_(at|rt)=/.test(c))).toEqual([]);
    const sessions = await sessionsOf(user.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ auth_method: "password", delivery: "bearer" });
    expect((await challengeRows(user.id))[0]?.["consumed_at"]).not.toBeNull();
    expect(await kinds(user.id)).toEqual(["sign_in_succeeded"]);
    expect((await twoStepRow(h, user.id))?.lastUsedStep).toBe(stepAt(NOW));
    const accessToken = (res.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const me = await call(api.app, "GET", "/me", undefined, { headers: bearer(accessToken) });
    expect(me.status).toBe(200);
  });

  it("TP-4.7x: the right code (cookie delivery, web header) → signed_in with tokens null and the session cookies set; a cookie session", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email, "cookie");

    const res = await verifyCookie(challenge, { code: codeAt(SECRET_BYTES, NOW) });

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ status: "signed_in", tokens: null, recoveryCodesLeft: null });
    const jar = cookieJar(res);
    expect(jar["__Secure-budmon_at"]).toMatch(TOKEN("bma"));
    expect(jar["__Secure-budmon_rt"]).toMatch(TOKEN("bmr"));
    const sessions = await sessionsOf(user.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ delivery: "cookie", client_kind: "web" });
  });

  it("TP-4.7: a recovery code → signed_in with recoveryCodesLeft 9; that code used; recovery_code_used with its email", async () => {
    const { user, codes } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);

    const res = await verifyBody(challenge, { recoveryCode: codes[0] ?? "" });

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ status: "signed_in", recoveryCodesLeft: 9 });
    expect((await recoveryCodeRows(h, user.id)).filter((r) => r.used)).toHaveLength(1);
    expect(await kinds(user.id)).toEqual(["recovery_code_used", "sign_in_succeeded"]);
    const event = (await securityEvents(h, user.id)).find((e) => e.kind === "recovery_code_used");
    expect(await emailJobs(api, "recovery_code_used")).toEqual([
      { kind: "recovery_code_used", refId: user.id, eventId: event?.id },
    ]);
    expect(await sessionsOf(user.id)).toHaveLength(1);
  });

  it("TP-4.7x: a recovery code typed in lower case without dashes is accepted", async () => {
    const { user, codes } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);
    const typed = (codes[2] ?? "").replaceAll("-", "").toLowerCase();

    const res = await verifyBody(challenge, { recoveryCode: typed });

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ status: "signed_in", recoveryCodesLeft: 9 });
  });

  it("TP-4.7: the same recovery code again (a new challenge) → 400 TWO_STEP_CODE_INVALID { attemptsLeft: 4 }; no second session", async () => {
    const { user, codes } = await twoStepUser(api, { now: NOW });
    const first = await verifyBody(await challengeFor(user.email), {
      recoveryCode: codes[0] ?? "",
    });
    expect(first.status).toBe(200);

    const again = await verifyBody(await challengeFor(user.email), {
      recoveryCode: codes[0] ?? "",
    });

    expect(again.status).toBe(400);
    expect(errorOf(again)).toEqual({ ...CODE_INVALID, data: { attemptsLeft: 4 } });
    expect(await sessionsOf(user.id)).toHaveLength(1);
  });

  it("TP-4.7: 5 wrong codes → attemptsLeft 4, 3, 2, 1, then TWO_STEP_CHALLENGE_EXPIRED with two_step_failed_sign_in and one two_step_failed email; a 6th (even the right code) → TWO_STEP_CHALLENGE_EXPIRED", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);
    const wrong = wrongCode(SECRET_BYTES, NOW);

    const firstFour = [];
    for (let i = 0; i < 4; i += 1) firstFour.push(await verifyBody(challenge, { code: wrong }));
    const fifth = await verifyBody(challenge, { code: wrong });
    const sixth = await verifyBody(challenge, { code: codeAt(SECRET_BYTES, NOW) });

    expect(firstFour.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    expect(firstFour.map((r) => errorOf(r))).toEqual(
      [4, 3, 2, 1].map((attemptsLeft) => ({ ...CODE_INVALID, data: { attemptsLeft } })),
    );
    expect(fifth.status).toBe(401);
    expect(errorOf(fifth)).toEqual(CHALLENGE_EXPIRED);
    expect(sixth.status).toBe(401);
    expect(errorOf(sixth)).toEqual(CHALLENGE_EXPIRED);
    expect(await kinds(user.id)).toEqual(["two_step_failed_sign_in"]);
    const event = (await securityEvents(h, user.id))[0];
    expect(await emailJobs(api, "two_step_failed")).toEqual([
      { kind: "two_step_failed", refId: user.id, eventId: event?.id },
    ]);
    const [row] = await challengeRows(user.id);
    expect(row?.["consumed_at"]).not.toBeNull();
    expect(row?.["attempts"]).toBe(5);
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("TP-4.7: the challenge 5 min + 1 ms after it was issued, with the right code → TWO_STEP_CHALLENGE_EXPIRED; no session", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);
    api.clock.set(NOW.add({ minutes: 5, milliseconds: 1 }));

    const res = await verifyBody(challenge, { code: codeAt(SECRET_BYTES, now()) });

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(CHALLENGE_EXPIRED);
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("TP-4.7x: exactly 5 min after it was issued the challenge is expired (expiresAt > now is required)", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);
    api.clock.set(NOW.add({ minutes: 5 }));

    const res = await verifyBody(challenge, { code: codeAt(SECRET_BYTES, now()) });

    expect(errorOf(res)).toEqual(CHALLENGE_EXPIRED);
  });

  it("TP-4.7x: 5 min − 1 ms after it was issued the challenge still signs in", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);
    api.clock.set(NOW.add({ minutes: 5 }).subtract({ milliseconds: 1 }));

    const res = await verifyBody(challenge, { code: codeAt(SECRET_BYTES, now()) });

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ status: "signed_in" });
  });

  it('TP-4.7: a cookie challenge verified with tokenDelivery "body" (the right code) → TWO_STEP_CHALLENGE_EXPIRED; no session', async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email, "cookie");

    const res = await verifyBody(challenge, { code: codeAt(SECRET_BYTES, NOW) });

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(CHALLENGE_EXPIRED);
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it('TP-4.7x: a body challenge presented as the cookie with tokenDelivery "cookie" → TWO_STEP_CHALLENGE_EXPIRED', async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email, "body");

    const res = await verifyCookie(challenge, { code: codeAt(SECRET_BYTES, NOW) });

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(CHALLENGE_EXPIRED);
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("TP-4.7x: a consumed challenge used again (the next step's code) → TWO_STEP_CHALLENGE_EXPIRED", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);
    expect((await verifyBody(challenge, { code: codeAt(SECRET_BYTES, NOW) })).status).toBe(200);

    const again = await verifyBody(challenge, { code: codeAt(SECRET_BYTES, NOW, 1) });

    expect(errorOf(again)).toEqual(CHALLENGE_EXPIRED);
    expect(await sessionsOf(user.id)).toHaveLength(1);
  });

  it("TP-4.7x: an unknown challenge token → TWO_STEP_CHALLENGE_EXPIRED", async () => {
    const res = await verifyBody(`bmc_${"A".repeat(43)}`, { code: "123456" });

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(CHALLENGE_EXPIRED);
  });

  it("TP-4.7x: a token that doesn't parse as a challenge → TWO_STEP_CHALLENGE_EXPIRED", async () => {
    const res = await verifyBody("not-a-token", { code: "123456" });

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual(CHALLENGE_EXPIRED);
  });

  it("TP-4.7x: neither code nor recoveryCode → 400 VALIDATION_FAILED required (path code); the challenge's attempts unchanged", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);

    const res = await call(api.app, "POST", "/auth/two-step/verify", {
      challengeToken: challenge,
      tokenDelivery: "body",
    });

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      data: { issues: [{ path: ["code"], code: "required", message: "Required" }] },
    });
    expect((await challengeRows(user.id))[0]?.["attempts"]).toBe(0);
  });

  it("TP-4.7x: both code and recoveryCode → 400 VALIDATION_FAILED on path code; no session", async () => {
    const { user, codes } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);

    const res = await call(api.app, "POST", "/auth/two-step/verify", {
      challengeToken: challenge,
      code: codeAt(SECRET_BYTES, NOW),
      recoveryCode: codes[0],
      tokenDelivery: "body",
    });

    expect(res.status).toBe(400);
    const error = errorOf(res) as { code: string; data?: { issues?: { path: unknown }[] } };
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.data?.issues?.[0]?.path).toEqual(["code"]);
    expect(await sessionsOf(user.id)).toEqual([]);
  });
});

describe("TP-4.8: the per-user TOTP limiter (D-8)", () => {
  /** A bearer session whose access token outlives the clock moves in these tests. */
  const longSession = (userId: string) =>
    sessionFactory(h, {
      userId,
      now: NOW,
      confirmedAt: NOW.subtract({ hours: 1 }),
      accessExpiresAt: NOW.add({ hours: 24 }),
    });

  const confirm = (accessToken: string, factor: Factor) =>
    call(api.app, "POST", "/me/confirm", factor, { headers: bearer(accessToken) });
  const disable = (accessToken: string, factor: Factor) =>
    call(api.app, "POST", "/me/two-step/disable", factor, { headers: bearer(accessToken) });

  it("TP-4.8: 10 wrong TOTP codes across sign-in, me.confirm and disable, then an 11th (the right code) → 429 RATE_LIMITED; recovery codes then succeed at sign-in and at me.confirm", async () => {
    const { user, codes } = await twoStepUser(api, { now: NOW });
    const session = await longSession(user.id);
    const wrong = wrongCode(SECRET_BYTES, NOW);
    const challenge = await challengeFor(user.email);

    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1)
      statuses.push((await verifyBody(challenge, { code: wrong })).status);
    for (let i = 0; i < 3; i += 1)
      statuses.push((await confirm(session.accessToken, { code: wrong })).status);
    for (let i = 0; i < 3; i += 1)
      statuses.push((await disable(session.accessToken, { code: wrong })).status);
    const eleventh = await confirm(session.accessToken, { code: codeAt(SECRET_BYTES, NOW) });
    const recoveryAtSignIn = await verifyBody(await challengeFor(user.email), {
      recoveryCode: codes[0] ?? "",
    });
    const recoveryAtConfirm = await confirm(session.accessToken, {
      recoveryCode: codes[1] ?? "",
    });

    expect(statuses).toEqual(Array.from({ length: 10 }, () => 400));
    expect(eleventh.status).toBe(429);
    expect(errorOf(eleventh).code).toBe("RATE_LIMITED");
    expect(eleventh.headers["retry-after"]).toBeDefined();
    expect(recoveryAtSignIn.status).toBe(200);
    expect(recoveryAtSignIn.json()).toMatchObject({ status: "signed_in", recoveryCodesLeft: 9 });
    expect(recoveryAtConfirm.status).toBe(200);
    expect(recoveryAtConfirm.json()).toEqual({
      confirmedUntil: wire(NOW.add({ minutes: 10 })),
    });
  }, 60_000);

  it("TP-4.8: 31 TOTP checks in a day, one every 15 minutes → the first 30 are checked (400) and the 31st (the right code) is 429 RATE_LIMITED", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const session = await longSession(user.id);

    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      api.clock.set(NOW.add({ minutes: 15 * i }));
      statuses.push(
        (await confirm(session.accessToken, { code: wrongCode(SECRET_BYTES, now()) })).status,
      );
    }
    api.clock.set(NOW.add({ minutes: 15 * 30 }));
    const last = await confirm(session.accessToken, { code: codeAt(SECRET_BYTES, now()) });

    expect(statuses).toEqual(Array.from({ length: 30 }, () => 400));
    expect(last.status).toBe(429);
    expect(errorOf(last).code).toBe("RATE_LIMITED");
  }, 120_000);
});

describe("TP-4.9: a code can't be replayed", () => {
  it("TP-4.9: signing in with code C, then again with C in the same step → 400 TWO_STEP_CODE_INVALID { attemptsLeft: 4 }", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const c = codeAt(SECRET_BYTES, NOW);
    const first = await verifyBody(await challengeFor(user.email), { code: c });

    const second = await verifyBody(await challengeFor(user.email), { code: c });

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(errorOf(second)).toEqual({ ...CODE_INVALID, data: { attemptsLeft: 4 } });
    expect(await sessionsOf(user.id)).toHaveLength(1);
  });

  it("TP-4.9x: after step s is used, the code for s − 1 is refused and the code for s + 1 signs in", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    expect(
      (await verifyBody(await challengeFor(user.email), { code: codeAt(SECRET_BYTES, NOW) }))
        .status,
    ).toBe(200);

    const earlier = await verifyBody(await challengeFor(user.email), {
      code: codeAt(SECRET_BYTES, NOW, -1),
    });
    const later = await verifyBody(await challengeFor(user.email), {
      code: codeAt(SECRET_BYTES, NOW, 1),
    });

    expect(errorOf(earlier)).toMatchObject(CODE_INVALID);
    expect(later.status).toBe(200);
    expect((await twoStepRow(h, user.id))?.lastUsedStep).toBe(stepAt(NOW) + 1);
  });
});

describe("TP-3.31: closure between the factors (moved from S-3, A-72)", () => {
  it("TP-3.31: the email banned and a ban deletion set between the factors, then the right code → 403 ACCOUNT_CLOSED; no session", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email);
    await banFactory(h, { email: user.email, now: NOW });
    await usersRepo.setDeletion(h, user.id, {
      requestedAt: new Date(NOW.epochMilliseconds),
      scheduledFor: new Date(NOW.add({ hours: 24 * 7 }).epochMilliseconds),
      requestedBy: "ban",
    });

    const res = await verifyBody(challenge, { code: codeAt(SECRET_BYTES, NOW) });

    expect(res.status).toBe(403);
    expect(errorOf(res)).toEqual({
      defined: true,
      code: "ACCOUNT_CLOSED",
      status: 403,
      message: "Account closed",
    });
    expect(await sessionsOf(user.id)).toEqual([]);
  });
});

describe("TP-4.36: login CSRF on auth.verifyTwoStep (F-36, A-72)", () => {
  it("TP-4.36: cookie delivery without the web client header → 403 FORBIDDEN; no cookies, no session; the challenge untouched", async () => {
    const { user } = await twoStepUser(api, { now: NOW });
    const challenge = await challengeFor(user.email, "cookie");

    const res = await verifyCookie(challenge, { code: codeAt(SECRET_BYTES, NOW) }, "android/1");

    expect(res.status).toBe(403);
    expect(errorOf(res)).toEqual({
      defined: true,
      code: "FORBIDDEN",
      status: 403,
      message: "Forbidden",
    });
    expect(setCookies(res)).toEqual([]);
    expect(await sessionsOf(user.id)).toEqual([]);
    const [row] = await challengeRows(user.id);
    expect(row?.["consumed_at"]).toBeNull();
    expect(row?.["attempts"]).toBe(0);
  });
});
