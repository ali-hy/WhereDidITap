// invitations.preview (F-40) and invitations.accept (F-41) through the real HTTP layer (identity
// LLD §4.2, §5.4, §6). TP-1.1 to TP-1.11, plus extra cases TP-1.xx ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import * as credentialsRepo from "../../../src/identity/credentialsRepo.js";
import * as invitationsRepo from "../../../src/identity/invitationsRepo.js";
import * as settingsRepo from "../../../src/identity/settingsRepo.js";
import { generateToken } from "../../../src/identity/tokens.js";
import {
  acceptInvitationRow,
  banFactory,
  invitationFactory,
  userFactory,
} from "../../factories/identity.js";
import { buildIdentityApi, setCookies, T0, type IdentityApi } from "../../support/identity.js";
import { call, errorOf, nextIp } from "../../support/identityHttp.js";
import { jobRows, templateJobRegistry, TEST_JOBS, type JobDefinition } from "../../support/jobs.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const PASSWORD = "violet staircase umbrella";

/** A subscriber on the template's test.ok queue, recording any identity event payload. */
const recorder = {
  ...TEST_JOBS.ok,
  payload: z.record(z.string(), z.unknown()),
} as unknown as JobDefinition<never>;

beforeAll(async () => {
  api = await buildIdentityApi({ overrides: { registry: templateJobRegistry() } });
  api.container.identity.events.subscribe("identity.invitation-ended", recorder);
  api.container.identity.events.subscribe("identity.user-created", recorder);
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

const wire = (i: Temporal.Instant): string => i.toString({ fractionalSecondDigits: 3 });

/** The payloads the events published to the recorder, oldest first. */
const published = async (): Promise<Record<string, unknown>[]> =>
  (await jobRows(api.testDb.database, TEST_JOBS.ok.name)).map(
    (r) => r.data as Record<string, unknown>,
  );

const emailJobs = async (refId: string) =>
  (await jobRows(api.testDb.database, "identity.email-send"))
    .map((r) => r.data as Record<string, unknown>)
    .filter((d) => d["refId"] === refId);

const preview = (token: string, ip?: string) =>
  call(api.app, "POST", "/invitations/preview", { token }, ip === undefined ? {} : { ip });

interface AcceptBody {
  token: string;
  displayName?: string;
  locale?: string;
  timeZone?: string;
  baseCurrency?: string;
  password?: string;
  tokenDelivery?: "cookie" | "body";
}

const accept = (b: AcceptBody, opts: { client?: string; ip?: string } = {}) =>
  call(
    api.app,
    "POST",
    "/invitations/accept",
    {
      token: b.token,
      displayName: b.displayName ?? "Mona Hassan",
      locale: b.locale ?? "en",
      timeZone: b.timeZone ?? "Africa/Cairo",
      baseCurrency: b.baseCurrency ?? "USD",
      method: { kind: "password", password: b.password ?? PASSWORD },
      tokenDelivery: b.tokenDelivery ?? "body",
    },
    {
      client: opts.client ?? ((b.tokenDelivery ?? "body") === "cookie" ? "web/1" : "android/1"),
      ...(opts.ip === undefined ? {} : { ip: opts.ip }),
    },
  );

async function invitation(
  input: Partial<Parameters<typeof invitationFactory>[1]> = {},
): Promise<{ invitationId: string; token: string; email: string }> {
  const email = input.email ?? `invitee-${nextIp().replaceAll(".", "-")}@example.com`;
  const { invitationId, token } = await invitationFactory(h, {
    email,
    now: NOW,
    withToken: true,
    ...input,
  });
  if (token === null) throw new Error("no token");
  return { invitationId, token, email };
}

const userByEmail = async (email: string) =>
  (await h.executeSql("SELECT * FROM users WHERE email = $1", [email])).rows[0];

const countUsers = async (): Promise<number> =>
  (await h.executeSql("SELECT count(*)::int AS n FROM users")).rows[0]?.["n"] as number;

describe("TP-1.1: invitations.preview", () => {
  it("TP-1.1: a valid invitation previews its email, inviter name, expiry and origin", async () => {
    const inviter = await userFactory(h, { displayName: "Ahmed Ali" });
    const inv = await invitation({ inviterUserId: inviter.id });

    const res = await preview(inv.token);

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      invitationId: inv.invitationId,
      email: inv.email,
      inviterName: "Ahmed Ali",
      expiresAt: wire(NOW.add({ hours: 24 * 7 })),
      origin: "direct",
    });
  });

  it("TP-1.1x: without an inviter, inviterName is null; the row is unchanged", async () => {
    const inv = await invitation({ origin: "bootstrap" });

    const res = await preview(inv.token);

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ inviterName: null, origin: "bootstrap" });
    expect((await invitationsRepo.findById(h, inv.invitationId))?.status).toBe("pending");
  });
});

describe("TP-1.2: malformed and unknown tokens", () => {
  it.each([
    ["the malformed token 'x'", () => "x"],
    ["a well-formed unknown token", () => generateToken("invitation")],
  ])("TP-1.2: %s → 400 INVITATION_INVALID", async (_label, token) => {
    const res = await preview(token());

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      defined: true,
      code: "INVITATION_INVALID",
      status: 400,
      message: "Invitation invalid",
    });
  });

  it("TP-1.2x: a token of another kind (a reset token) → INVITATION_INVALID", async () => {
    const res = await preview(generateToken("reset"));

    expect(errorOf(res).code).toBe("INVITATION_INVALID");
  });
});

describe("TP-1.3: expiry at the boundary", () => {
  it("TP-1.3: expires_at = now → 410 INVITATION_EXPIRED { expiredAt }, stored expired, invitation-ended published", async () => {
    const inv = await invitation({ expiresAt: NOW });

    const res = await preview(inv.token);

    expect(res.status).toBe(410);
    expect(errorOf(res)).toMatchObject({
      code: "INVITATION_EXPIRED",
      message: "Invitation expired",
      data: { expiredAt: wire(NOW) },
    });
    expect((await invitationsRepo.findById(h, inv.invitationId))?.status).toBe("expired");
    expect(await published()).toEqual([{ invitationId: inv.invitationId, reason: "expired" }]);
  });

  it("TP-1.3: expires_at = now + 1 ms previews fine and stays pending", async () => {
    const inv = await invitation({ expiresAt: NOW.add({ milliseconds: 1 }) });

    const res = await preview(inv.token);

    expect(res.status).toBe(200);
    expect((await invitationsRepo.findById(h, inv.invitationId))?.status).toBe("pending");
    expect(await published()).toEqual([]);
  });

  it("TP-1.3x: an invitation already stored expired → INVITATION_EXPIRED with its expires_at, no second event", async () => {
    const inv = await invitation({ expiresAt: NOW.subtract({ hours: 1 }) });
    await preview(inv.token);

    const res = await preview(inv.token);

    expect(errorOf(res)).toMatchObject({
      code: "INVITATION_EXPIRED",
      data: { expiredAt: wire(NOW.subtract({ hours: 1 })) },
    });
    expect(await published()).toHaveLength(1);
  });
});

describe("TP-1.4: revoked and used invitations", () => {
  it("TP-1.4: revoked → 410 INVITATION_REVOKED", async () => {
    const inv = await invitation({ revokedAt: NOW.subtract({ minutes: 1 }) });

    const res = await preview(inv.token);

    expect(res.status).toBe(410);
    expect(errorOf(res)).toMatchObject({
      code: "INVITATION_REVOKED",
      message: "Invitation revoked",
    });
  });

  it.each([
    [9, true],
    [11, false],
  ])(
    "TP-1.4: accepted %i minutes ago → 409 INVITATION_USED { recent: %s }",
    async (minutes, recent) => {
      const inv = await invitation();
      const accepted = await userFactory(h, { email: `accepted-${String(minutes)}@example.com` });
      await acceptInvitationRow(h, inv.invitationId, accepted.id, NOW.subtract({ minutes }));

      const res = await preview(inv.token);

      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: "INVITATION_USED",
        message: "Invitation already used",
        data: { recent },
      });
    },
  );

  it("TP-1.4x: accepted exactly RECENT_ACCEPT_WINDOW (10 minutes) ago is still recent", async () => {
    const inv = await invitation();
    const accepted = await userFactory(h, { email: "accepted-10@example.com" });
    await acceptInvitationRow(h, inv.invitationId, accepted.id, NOW.subtract({ minutes: 10 }));

    expect(errorOf(await preview(inv.token)).data).toEqual({ recent: true });
  });
});

describe("TP-1.5: a banned email", () => {
  it("TP-1.5: an invitation whose email is then banned → INVITATION_INVALID (no reason)", async () => {
    const inv = await invitation();
    await banFactory(h, { email: inv.email, now: NOW });

    const res = await preview(inv.token);

    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      defined: true,
      code: "INVITATION_INVALID",
      status: 400,
      message: "Invitation invalid",
    });
  });
});

describe("TP-1.6: accepting with a password", () => {
  it("TP-1.6: body delivery creates the user, the credential and a session, returns tokens and a device token, and records the event and job", async () => {
    const inviter = await userFactory(h);
    const inv = await invitation({ inviterUserId: inviter.id });

    const res = await accept({ token: inv.token, tokenDelivery: "body" });

    expect(res.status).toBe(200);
    const body = res.json() as {
      status: string;
      tokens: { accessToken: string; refreshToken: string; deviceToken: string | null } | null;
    };
    expect(body.status).toBe("signed_in");
    expect(body.tokens?.accessToken).toMatch(/^bma_/);
    expect(body.tokens?.refreshToken).toMatch(/^bmr_/);
    expect(body.tokens?.deviceToken).toMatch(/^bmd_/);

    const user = await userByEmail(inv.email);
    expect(user).toMatchObject({
      display_name: "Mona Hassan",
      locale: "en",
      time_zone: "Africa/Cairo",
      base_currency: "USD",
      status: "active",
      invite_allowance: 3,
      invited_by_user_id: inviter.id,
      is_product_owner: false,
    });
    expect((user?.["email_verified_at"] as Date).toISOString()).toBe(T0);
    const userId = user?.["id"] as string;
    expect((await credentialsRepo.getPasswordHash(h, userId))?.hash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
    expect(await invitationsRepo.findById(h, inv.invitationId)).toMatchObject({
      status: "accepted",
      acceptedUserId: userId,
    });
    const sessions = await h.executeSql(
      "SELECT auth_method, delivery FROM sessions WHERE user_id = $1",
      [userId],
    );
    expect(sessions.rows).toEqual([{ auth_method: "sign_up", delivery: "bearer" }]);
    const events = await h.executeSql("SELECT kind FROM security_events WHERE user_id = $1", [
      userId,
    ]);
    expect(events.rows).toEqual([{ kind: "sign_up" }]);
    expect(await published()).toEqual([{ userId, invitationId: inv.invitationId }]);
  });

  it("TP-1.6: cookie delivery (X-Budmon-Client web/1) sets the session cookies and returns tokens: null", async () => {
    const inv = await invitation();

    const res = await accept({ token: inv.token, tokenDelivery: "cookie" });

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ status: "signed_in", tokens: null });
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith("__Secure-budmon_at=bma_"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("__Secure-budmon_rt=bmr_"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("__Secure-budmon_dv=bmd_"))).toBe(true);
    const user = await userByEmail(inv.email);
    const sessions = await h.executeSql("SELECT delivery FROM sessions WHERE user_id = $1", [
      user?.["id"],
    ]);
    expect(sessions.rows).toEqual([{ delivery: "cookie" }]);
  });

  it("TP-1.6x: a bootstrap invitation makes the owner, with no invite allowance", async () => {
    const inv = await invitation({ origin: "bootstrap" });

    const res = await accept({ token: inv.token });

    expect(res.status).toBe(200);
    expect(await userByEmail(inv.email)).toMatchObject({
      is_product_owner: true,
      invite_allowance: null,
      invited_by_user_id: null,
    });
  });

  it("TP-1.6x: the stored time zone is the canonical name (Asia/Calcutta → Asia/Kolkata where the runtime canonicalises)", async () => {
    const inv = await invitation();
    const canonical = new Intl.DateTimeFormat("en", { timeZone: "Asia/Calcutta" }).resolvedOptions()
      .timeZone;

    expect((await accept({ token: inv.token, timeZone: "Asia/Calcutta" })).status).toBe(200);
    expect((await userByEmail(inv.email))?.["time_zone"]).toBe(canonical);
  });
});

describe("TP-1.7: accept errors", () => {
  it.each([
    ["short", "too_short"],
    ["password1234", "common"],
  ])(
    "TP-1.7: password %j → 400 PASSWORD_TOO_WEAK { reason: %s }, no user",
    async (password, reason) => {
      const inv = await invitation();

      const res = await accept({ token: inv.token, password });

      expect(res.status).toBe(400);
      expect(errorOf(res)).toMatchObject({
        code: "PASSWORD_TOO_WEAK",
        message: "Password too weak",
        data: { reason },
      });
      expect(await userByEmail(inv.email)).toBeUndefined();
    },
  );

  it("TP-1.7x: a password containing the invited email's local part → PASSWORD_TOO_WEAK { contains_email }", async () => {
    const inv = await invitation({ email: "monahassan@example.com" });

    const res = await accept({ token: inv.token, password: "my monahassan secret" });

    expect(errorOf(res)).toMatchObject({
      code: "PASSWORD_TOO_WEAK",
      data: { reason: "contains_email" },
    });
  });

  it("TP-1.7: cap = the current user count → 409 USER_CAP_REACHED, no user, the invitation still pending, and one invitation_cap_failed job per recipient committed", async () => {
    await userFactory(h, { isProductOwner: true });
    const inviter = await userFactory(h);
    const inv = await invitation({ inviterUserId: inviter.id });
    await settingsRepo.setUserCap(h, await countUsers());

    const res = await accept({ token: inv.token });

    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({ code: "USER_CAP_REACHED", message: "User cap reached" });
    expect(await userByEmail(inv.email)).toBeUndefined();
    expect(await countUsers()).toBe(2);
    expect((await invitationsRepo.findById(h, inv.invitationId))?.status).toBe("pending");
    const jobs = await emailJobs(inv.invitationId);
    expect(
      jobs
        .map((j) => ({ kind: j["kind"], recipient: j["recipient"] }))
        .sort((a, b) => String(a.recipient).localeCompare(String(b.recipient))),
    ).toEqual([
      { kind: "invitation_cap_failed", recipient: "inviter" },
      { kind: "invitation_cap_failed", recipient: "owner" },
    ]);
    expect(await published()).toEqual([]);
  });

  it("TP-1.7: an existing user with the invited email → 409 INVITATION_USED", async () => {
    const inv = await invitation();
    await userFactory(h, { email: inv.email });

    const res = await accept({ token: inv.token });

    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({ code: "INVITATION_USED", data: { recent: false } });
    expect((await invitationsRepo.findById(h, inv.invitationId))?.status).toBe("pending");
  });

  it("TP-1.7: bad profile fields → 400 VALIDATION_FAILED with the four issue codes, no user", async () => {
    const inv = await invitation();

    const res = await accept({
      token: inv.token,
      timeZone: "Mars/Base",
      baseCurrency: "XXX",
      locale: "fr",
      displayName: "",
    });

    expect(res.status).toBe(400);
    const error = errorOf(res) as { code: string; data: { issues: unknown[] } };
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.data.issues).toHaveLength(4);
    expect(error.data.issues).toEqual(
      expect.arrayContaining([
        { path: ["displayName"], code: "too_small", message: "Too small" },
        { path: ["locale"], code: "unsupported_locale", message: "Unsupported locale" },
        { path: ["timeZone"], code: "invalid_time_zone", message: "Invalid time zone" },
        { path: ["baseCurrency"], code: "unknown_currency", message: "Unknown currency" },
      ]),
    );
    expect(await userByEmail(inv.email)).toBeUndefined();
  });

  it.each([
    ["expired", { expiresAt: NOW.subtract({ minutes: 1 }) }, 410, "INVITATION_EXPIRED"],
    ["revoked", { revokedAt: NOW.subtract({ minutes: 1 }) }, 410, "INVITATION_REVOKED"],
  ] as const)("TP-1.7x: accepting a %s invitation → %i %s", async (_label, input, status, code) => {
    const inv = await invitation(input);

    const res = await accept({ token: inv.token });

    expect(res.status).toBe(status);
    expect(errorOf(res).code).toBe(code);
    expect(await userByEmail(inv.email)).toBeUndefined();
  });

  it("TP-1.7x: accepting with a malformed token → 400 INVITATION_INVALID", async () => {
    expect(errorOf(await accept({ token: "x" })).code).toBe("INVITATION_INVALID");
  });

  it("TP-1.7x: a second accept of the same invitation → INVITATION_USED { recent: true }", async () => {
    const inv = await invitation();
    expect((await accept({ token: inv.token })).status).toBe(200);

    const res = await accept({ token: inv.token });

    expect(errorOf(res)).toMatchObject({ code: "INVITATION_USED", data: { recent: true } });
  });
});

describe("TP-1.7x (review B-8): accept-side F-41 checks", () => {
  it("TP-1.7x: accepting an invitation whose expires_at is now → INVITATION_EXPIRED; the row stays expired after the error; one invitation-ended published", async () => {
    const inv = await invitation({ expiresAt: NOW });

    const res = await accept({ token: inv.token });

    expect(res.status).toBe(410);
    expect(errorOf(res)).toMatchObject({
      code: "INVITATION_EXPIRED",
      data: { expiredAt: wire(NOW) },
    });
    expect((await invitationsRepo.findById(h, inv.invitationId))?.status).toBe("expired");
    expect(await published()).toEqual([{ invitationId: inv.invitationId, reason: "expired" }]);
    expect(await userByEmail(inv.email)).toBeUndefined();
  });

  it("TP-1.7x: accepting after the invited email was banned → INVITATION_INVALID, no user", async () => {
    const inv = await invitation();
    await banFactory(h, { email: inv.email, now: NOW });

    const res = await accept({ token: inv.token });

    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe("INVITATION_INVALID");
    expect(await userByEmail(inv.email)).toBeUndefined();
    expect((await invitationsRepo.findById(h, inv.invitationId))?.status).toBe("pending");
  });

  it("TP-1.7x: the cap with the owner as the inviter → exactly one invitation_cap_failed job, recipient inviter (§7.2: owner only when it isn't the inviter)", async () => {
    const owner = await userFactory(h, { isProductOwner: true });
    const inv = await invitation({ inviterUserId: owner.id });
    await settingsRepo.setUserCap(h, await countUsers());

    const res = await accept({ token: inv.token });

    expect(errorOf(res).code).toBe("USER_CAP_REACHED");
    expect(
      (await emailJobs(inv.invitationId)).map((j) => ({
        kind: j["kind"],
        recipient: j["recipient"],
      })),
    ).toEqual([{ kind: "invitation_cap_failed", recipient: "inviter" }]);
  });

  it("TP-1.7x: the cap with no inviter (an owner exists) → exactly one invitation_cap_failed job, recipient owner", async () => {
    await userFactory(h, { isProductOwner: true });
    const inv = await invitation();
    await settingsRepo.setUserCap(h, await countUsers());

    const res = await accept({ token: inv.token });

    expect(errorOf(res).code).toBe("USER_CAP_REACHED");
    expect(
      (await emailJobs(inv.invitationId)).map((j) => ({
        kind: j["kind"],
        recipient: j["recipient"],
      })),
    ).toEqual([{ kind: "invitation_cap_failed", recipient: "owner" }]);
  });
});

describe("TP-1.44: a Google accept before S-6 (A-46)", () => {
  it("TP-1.44: method google with ticket 'not-a-ticket' → 400 SIGNUP_TICKET_INVALID; no user, no session, the invitation still pending", async () => {
    const inv = await invitation();

    const res = await call(
      api.app,
      "POST",
      "/invitations/accept",
      {
        token: inv.token,
        displayName: "Mona Hassan",
        locale: "en",
        timeZone: "Africa/Cairo",
        baseCurrency: "USD",
        method: { kind: "google", ticket: "not-a-ticket" },
        tokenDelivery: "body",
      },
      { client: "android/1" },
    );

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      defined: true,
      code: "SIGNUP_TICKET_INVALID",
      message: "Sign-up ticket invalid",
    });
    expect(await userByEmail(inv.email)).toBeUndefined();
    expect((await h.executeSql("SELECT count(*)::int AS n FROM sessions")).rows[0]?.["n"]).toBe(0);
    expect((await invitationsRepo.findById(h, inv.invitationId))?.status).toBe("pending");
  });
});

describe("TP-1.8: two concurrent accepts", () => {
  it("TP-1.8: one answers 200, the other INVITATION_USED; one user exists", async () => {
    const inv = await invitation();

    const results = await Promise.all([accept({ token: inv.token }), accept({ token: inv.token })]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser === undefined ? undefined : errorOf(loser).code).toBe("INVITATION_USED");
    expect(
      (await h.executeSql("SELECT count(*)::int AS n FROM users WHERE email = $1", [inv.email]))
        .rows[0]?.["n"],
    ).toBe(1);
  });
});

describe("TP-1.9: pending invitations don't count against the cap", () => {
  it("TP-1.9: cap = users + 1 with 3 other pending invitations → the accept succeeds", async () => {
    await userFactory(h);
    await userFactory(h);
    for (const n of [1, 2, 3]) await invitation({ email: `other-${String(n)}@example.com` });
    const inv = await invitation();
    await settingsRepo.setUserCap(h, (await countUsers()) + 1);

    const res = await accept({ token: inv.token });

    expect(res.status).toBe(200);
    expect(await countUsers()).toBe(3);
  });
});

describe("TP-1.10: cookie delivery needs the web client", () => {
  it("TP-1.10: tokenDelivery cookie with X-Budmon-Client android/1 → 403 FORBIDDEN, no user", async () => {
    const inv = await invitation();

    const res = await accept(
      { token: inv.token, tokenDelivery: "cookie" },
      { client: "android/1" },
    );

    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe("FORBIDDEN");
    expect(setCookies(res)).toEqual([]);
    expect(await userByEmail(inv.email)).toBeUndefined();
  });
});

describe("TP-1.11: token.ip", () => {
  it("TP-1.11: 31 previews from one IP within 10 minutes: the first 30 answer, the 31st is 429 RATE_LIMITED with Retry-After", async () => {
    const inv = await invitation();
    const ip = nextIp();

    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      statuses.push((await preview(inv.token, ip)).status);
    }
    const last = await preview(inv.token, ip);

    expect(statuses).toEqual(Array.from({ length: 30 }, () => 200));
    expect(last.status).toBe(429);
    expect(errorOf(last).code).toBe("RATE_LIMITED");
    expect(last.headers["retry-after"]).toBeDefined();
  });

  it("TP-1.11x: another IP is not limited by the first one's previews", async () => {
    const inv = await invitation();
    const ip = nextIp();
    for (let i = 0; i < 31; i += 1) await preview(inv.token, ip);

    expect((await preview(inv.token)).status).toBe(200);
  });
});
