// Turning two-step on and managing it: me.twoStepSetup (F-63), me.twoStepEnable (F-64),
// me.acknowledgeRecoveryCodes (F-65), me.twoStepDisable (F-66), me.regenerateRecoveryCodes
// (F-67), me.twoStepReplaceStart and me.twoStepReplaceConfirm (F-68), through the real HTTP layer
// (identity LLD §4.5, §5.3, §6). TP-4.5, TP-4.6, TP-4.10 to TP-4.13, TP-4.38 (disable), plus extra
// cases ending in "x".
// Codes come from test/support/totp.ts (RFC 6238, independent of F-60); the clock is fixed at T0.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { identityGrants } from "../../../src/identity/identityGrants.js";
import {
  FACTORY_PASSWORD,
  passwordFactory,
  pendingSecretFactory,
  sessionFactory,
  userFactory,
  type FactorySession,
} from "../../factories/identity.js";
import { buildIdentityApi, T0, type IdentityApi } from "../../support/identity.js";
import { call, errorOf } from "../../support/identityHttp.js";
import { resetBetweenTests } from "../../support/testDatabase.js";
import { base32ToBytes, codeAt, stepAt, wrongCode } from "../../support/totp.js";
import {
  apiSecretsOf,
  bearer,
  emailJobs,
  limiterHits,
  recoveryCodeRows,
  recoveryRingOf,
  SECRET_BYTES,
  securityEvents,
  TOO_MANY_FACTORS,
  totpContext,
  twoStepRow,
  twoStepUser,
} from "../../support/twoStep.js";

let api: IdentityApi;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const HOUR_AGO = NOW.subtract({ hours: 1 });
const wire = (i: Temporal.Instant): string => i.toString({ fractionalSecondDigits: 3 });
const FORMAT = /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/;

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

const post = (path: string, body: unknown, session: FactorySession) =>
  call(api.app, "POST", path, body, { headers: bearer(session.accessToken) });

const meOf = async (session: FactorySession) =>
  (await call(api.app, "GET", "/me", undefined, { headers: bearer(session.accessToken) })).json();

const confirmationRequired = (factor: string) => ({
  defined: true,
  code: "CONFIRMATION_REQUIRED",
  status: 403,
  message: "Confirmation required",
  data: { factor },
});
const ALREADY_ENABLED = {
  defined: true,
  code: "TWO_STEP_ALREADY_ENABLED",
  status: 409,
  message: "Two-step already enabled",
};
const NOT_ENABLED = {
  defined: true,
  code: "TWO_STEP_NOT_ENABLED",
  status: 409,
  message: "Two-step not enabled",
};
const SETUP_EXPIRED = {
  defined: true,
  code: "TWO_STEP_SETUP_EXPIRED",
  status: 410,
  message: "Two-step setup expired",
};
const CODE_INVALID = {
  defined: true,
  code: "TWO_STEP_CODE_INVALID",
  status: 400,
  message: "Invalid two-step code",
};

/** A password user without two-step, and a session confirmed at `confirmedAt`. */
/**
 * The access token lasts an hour, past the 15-minute setup window, so the expiry cases reach the
 * setup check rather than the auth hook's 401.
 */
const ACCESS_EXPIRES_AT = NOW.add({ hours: 1 });

async function passwordUser(confirmedAt: Temporal.Instant) {
  const user = await userFactory(h);
  await passwordFactory(h, user.id);
  const session = await sessionFactory(h, {
    userId: user.id,
    now: NOW,
    confirmedAt,
    accessExpiresAt: ACCESS_EXPIRES_AT,
  });
  return { user, session };
}

/** A two-step user (TWO_STEP_SECRET, the known codes) and a session confirmed at `confirmedAt`. */
async function twoStepSignedIn(confirmedAt: Temporal.Instant, codesAcknowledged?: boolean) {
  const { user, codes } = await twoStepUser(api, {
    now: NOW,
    ...(codesAcknowledged === undefined ? {} : { codesAcknowledged }),
  });
  const session = await sessionFactory(h, {
    userId: user.id,
    now: NOW,
    confirmedAt,
    accessExpiresAt: ACCESS_EXPIRES_AT,
  });
  return { user, codes, session };
}

interface SetupWire {
  secret: string;
  otpauthUri: string;
  expiresAt: string;
}

/**
 * Checks a setup-shaped response for `email` and returns the secret's bytes.
 * The secret is grouped in 4s with single spaces (A-99); the URI carries it without spaces.
 */
function expectSetup(body: SetupWire, email: string, expiresAt: Temporal.Instant): Buffer {
  expect(body.secret).toMatch(/^([A-Z2-7]{4} )*[A-Z2-7]{1,4}$/);
  const ungrouped = body.secret.replaceAll(" ", "");
  expect(ungrouped).toMatch(/^[A-Z2-7]{32}$/);
  expect(body.otpauthUri).toBe(
    `otpauth://totp/wDit:${encodeURIComponent(email)}?secret=${ungrouped}&issuer=wDit&algorithm=SHA1&digits=6&period=30`,
  );
  expect(body.expiresAt).toBe(wire(expiresAt));
  const bytes = base32ToBytes(ungrouped);
  expect(bytes).toHaveLength(20);
  return bytes;
}

const unseal = (envelope: Buffer | null | undefined, userId: string): Buffer => {
  if (envelope === null || envelope === undefined) throw new Error("no envelope");
  return apiSecretsOf(api).unseal(envelope, totpContext(userId));
};

const signInChallenge = async (email: string): Promise<string> => {
  const res = await call(api.app, "POST", "/auth/sign-in", {
    email,
    password: FACTORY_PASSWORD,
    tokenDelivery: "body",
  });
  return (res.json() as { challengeToken: string }).challengeToken;
};

const verify = (challengeToken: string, code: string) =>
  call(api.app, "POST", "/auth/two-step/verify", {
    challengeToken,
    code,
    tokenDelivery: "body",
  });

const sessionCount = async (userId: string): Promise<number> =>
  Number(
    (await h.executeSql("SELECT count(*)::int AS n FROM sessions WHERE user_id = $1", [userId]))
      .rows[0]?.["n"],
  );

const sessionRow = async (sessionId: string) =>
  (await h.executeSql("SELECT revoked_at, revoke_reason FROM sessions WHERE id = $1", [sessionId]))
    .rows[0];

/** The email job F-20 queued for the user's one event of `kind`. */
async function expectEventWithEmail(userId: string, kind: string): Promise<void> {
  const events = (await securityEvents(h, userId)).filter((e) => e.kind === kind);
  expect(events).toHaveLength(1);
  expect(await emailJobs(api, kind)).toEqual([{ kind, refId: userId, eventId: events[0]?.id }]);
}

describe("TP-4.5: me.twoStepSetup", () => {
  it("TP-4.5: without step-up → 403 CONFIRMATION_REQUIRED { factor: password }; no two-step row", async () => {
    const { user, session } = await passwordUser(HOUR_AGO);

    const res = await post("/me/two-step/setup", {}, session);

    expect(res.status).toBe(403);
    expect(errorOf(res)).toEqual(confirmationRequired("password"));
    expect(await twoStepRow(h, user.id)).toBeNull();
  });

  it("TP-4.5: with step-up → the secret in groups of 4 separated by single spaces, the otpauth URI with the same characters unspaced and expiresAt now + 15 min; a pending row whose envelope holds that secret", async () => {
    const { user, session } = await passwordUser(NOW);

    const res = await post("/me/two-step/setup", {}, session);

    expect(res.status).toBe(200);
    const secret = expectSetup(res.json() as SetupWire, user.email, NOW.add({ minutes: 15 }));
    const row = await twoStepRow(h, user.id);
    expect(row).toMatchObject({
      state: "pending",
      secretEnvelope: null,
      pendingExpiresAt: NOW.add({ minutes: 15 }).epochMilliseconds,
    });
    expect(unseal(row?.pendingSecretEnvelope, user.id).equals(secret)).toBe(true);
  });

  it("TP-4.5: setup again a minute later → a new secret replaces the pending one (one row, expiry now + 15 min)", async () => {
    const { user, session } = await passwordUser(NOW);
    const first = expectSetup(
      (await post("/me/two-step/setup", {}, session)).json() as SetupWire,
      user.email,
      NOW.add({ minutes: 15 }),
    );
    api.clock.set(NOW.add({ minutes: 1 }));

    const res = await post("/me/two-step/setup", {}, session);

    expect(res.status).toBe(200);
    const second = expectSetup(res.json() as SetupWire, user.email, NOW.add({ minutes: 16 }));
    expect(second.equals(first)).toBe(false);
    const row = await twoStepRow(h, user.id);
    expect(row).toMatchObject({
      state: "pending",
      pendingExpiresAt: NOW.add({ minutes: 16 }).epochMilliseconds,
    });
    expect(unseal(row?.pendingSecretEnvelope, user.id).equals(second)).toBe(true);
    const { rows } = await h.executeSql(
      "SELECT count(*)::int AS n FROM two_step_credentials WHERE user_id = $1",
      [user.id],
    );
    expect(rows[0]?.["n"]).toBe(1);
  });

  it("TP-4.5: with two-step enabled → 409 TWO_STEP_ALREADY_ENABLED; the row unchanged", async () => {
    const { user, session } = await twoStepSignedIn(NOW);
    const before = await twoStepRow(h, user.id);

    const res = await post("/me/two-step/setup", {}, session);

    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual(ALREADY_ENABLED);
    expect(await twoStepRow(h, user.id)).toEqual(before);
  });
});

describe("TP-4.6: me.twoStepEnable", () => {
  /** A password user with a pending TWO_STEP_SECRET (expiring now + 15 min), this session (confirmed now) and 2 others. */
  async function pendingSetup() {
    const { user, session } = await passwordUser(NOW);
    await pendingSecretFactory(h, apiSecretsOf(api), {
      userId: user.id,
      expiresAt: NOW.add({ minutes: 15 }),
    });
    const others = [
      await sessionFactory(h, { userId: user.id, now: NOW }),
      await sessionFactory(h, { userId: user.id, now: NOW }),
    ];
    return { user, session, others };
  }

  it("TP-4.6: a wrong code → 400 TWO_STEP_CODE_INVALID; still pending; no session revoked", async () => {
    const { user, session, others } = await pendingSetup();

    const res = await post("/me/two-step/enable", { code: wrongCode(SECRET_BYTES, NOW) }, session);

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject(CODE_INVALID);
    expect((await twoStepRow(h, user.id))?.state).toBe("pending");
    for (const s of others) expect((await sessionRow(s.sessionId))?.["revoked_at"]).toBeNull();
  });

  it("TP-4.6: 15 min + 1 ms after setup (step-up renewed with the password), the right code → 410 TWO_STEP_SETUP_EXPIRED; not enabled", async () => {
    const { user, session } = await pendingSetup();
    api.clock.set(NOW.add({ minutes: 15, milliseconds: 1 }));
    const confirmed = await post("/me/confirm", { password: FACTORY_PASSWORD }, session);
    expect(confirmed.status).toBe(200);

    const res = await post(
      "/me/two-step/enable",
      { code: codeAt(SECRET_BYTES, api.clock.now()) },
      session,
    );

    expect(res.status).toBe(410);
    expect(errorOf(res)).toEqual(SETUP_EXPIRED);
    expect((await twoStepRow(h, user.id))?.state).not.toBe("enabled");
  });

  it("TP-4.6: the right code → 10 recovery codes; enabled; no code string in any identity table; the 2 other sessions revoked two_step_enabled, this one live; two_step_enabled with its email", async () => {
    const { user, session, others } = await pendingSetup();

    const res = await post("/me/two-step/enable", { code: codeAt(SECRET_BYTES, NOW) }, session);

    expect(res.status).toBe(200);
    const { recoveryCodes } = res.json() as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes) expect(code).toMatch(FORMAT);
    expect(new Set(recoveryCodes).size).toBe(10);
    // Enabled with the pending secret; the step is used; codes not yet acknowledged.
    const row = await twoStepRow(h, user.id);
    expect(row).toMatchObject({
      state: "enabled",
      pendingSecretEnvelope: null,
      pendingExpiresAt: null,
      lastUsedStep: stepAt(NOW),
      codesAcknowledged: false,
    });
    expect(unseal(row?.secretEnvelope, user.id).equals(SECRET_BYTES)).toBe(true);
    // Ten unused codes, stored only as HMACs under the current key.
    const stored = await recoveryCodeRows(h, user.id);
    expect(stored).toHaveLength(10);
    for (const r of stored)
      expect(r).toMatchObject({ keyId: recoveryRingOf(api).current, used: false });
    const dump = (
      await Promise.all(
        Object.keys(identityGrants).map(async (table) =>
          (await h.executeSql(`SELECT t::text AS row FROM ${table} t`)).rows
            .map((r) => String(r["row"]))
            .join("\n"),
        ),
      )
    ).join("\n");
    for (const code of recoveryCodes) {
      const plain = code.replaceAll("-", "");
      for (const form of [code, plain, plain.toLowerCase()]) {
        expect(dump.includes(form), form).toBe(false);
        expect(dump.includes(Buffer.from(form, "utf8").toString("hex")), `${form} as hex`).toBe(
          false,
        );
      }
    }
    // Other sessions revoked (D-3); this one live.
    for (const s of others) {
      const r = await sessionRow(s.sessionId);
      expect(r?.["revoked_at"]).not.toBeNull();
      expect(r?.["revoke_reason"]).toBe("two_step_enabled");
    }
    expect((await sessionRow(session.sessionId))?.["revoked_at"]).toBeNull();
    await expectEventWithEmail(user.id, "two_step_enabled");
    expect(await meOf(session)).toMatchObject({
      twoStep: { enabled: true, recoveryCodesLeft: 10, codesAcknowledged: false },
    });
  });

  it("TP-4.6x: a recovery code returned by enable confirms at me.confirm", async () => {
    const { session } = await pendingSetup();
    const enabled = await post("/me/two-step/enable", { code: codeAt(SECRET_BYTES, NOW) }, session);
    const { recoveryCodes } = enabled.json() as { recoveryCodes: string[] };

    const res = await post("/me/confirm", { recoveryCode: recoveryCodes[3] }, session);

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ confirmedUntil: wire(NOW.add({ minutes: 10 })) });
  });

  it("TP-4.6x: without step-up → 403 CONFIRMATION_REQUIRED { factor: password }; still pending", async () => {
    const { user } = await pendingSetup();
    const stale = await sessionFactory(h, { userId: user.id, now: NOW, confirmedAt: HOUR_AGO });

    const res = await post("/me/two-step/enable", { code: codeAt(SECRET_BYTES, NOW) }, stale);

    expect(res.status).toBe(403);
    expect(errorOf(res)).toEqual(confirmationRequired("password"));
    expect((await twoStepRow(h, user.id))?.state).toBe("pending");
  });

  it("TP-4.6x: no setup started → 410 TWO_STEP_SETUP_EXPIRED", async () => {
    const { session } = await passwordUser(NOW);

    const res = await post("/me/two-step/enable", { code: codeAt(SECRET_BYTES, NOW) }, session);

    expect(res.status).toBe(410);
    expect(errorOf(res)).toEqual(SETUP_EXPIRED);
  });

  it("TP-4.6x: two-step already enabled → 409 TWO_STEP_ALREADY_ENABLED", async () => {
    const { session } = await twoStepSignedIn(NOW);

    const res = await post("/me/two-step/enable", { code: codeAt(SECRET_BYTES, NOW) }, session);

    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual(ALREADY_ENABLED);
  });
});

describe("TP-4.10: me.twoStepDisable", () => {
  it("TP-4.10: without a code → 400 VALIDATION_FAILED required (path code); still enabled", async () => {
    const { user, session } = await twoStepSignedIn(HOUR_AGO);

    const res = await post("/me/two-step/disable", {}, session);

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      data: { issues: [{ path: ["code"], code: "required", message: "Required" }] },
    });
    expect((await twoStepRow(h, user.id))?.state).toBe("enabled");
  });

  it("TP-4.38: both a code and a recovery code → 400 VALIDATION_FAILED too_many_factors (path []); no limiter hit; still enabled with every recovery code unused", async () => {
    const { user, codes, session } = await twoStepSignedIn(HOUR_AGO);
    const hitsBefore = await limiterHits(h);

    const res = await post(
      "/me/two-step/disable",
      { code: codeAt(SECRET_BYTES, NOW), recoveryCode: codes[0] },
      session,
    );

    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual(TOO_MANY_FACTORS);
    expect(await limiterHits(h)).toEqual(hitsBefore);
    expect((await twoStepRow(h, user.id))?.state).toBe("enabled");
    expect((await recoveryCodeRows(h, user.id)).filter((r) => r.used)).toEqual([]);
  });

  it("TP-4.38x: both factors for a user without two-step → too_many_factors (the factor count is checked before TWO_STEP_NOT_ENABLED)", async () => {
    const { session } = await passwordUser(NOW);

    const res = await post(
      "/me/two-step/disable",
      { code: "123456", recoveryCode: "7KQ2-M3XD-4TRA" },
      session,
    );

    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual(TOO_MANY_FACTORS);
  });

  it("TP-4.10: a wrong code → 400 TWO_STEP_CODE_INVALID; still enabled", async () => {
    const { user, session } = await twoStepSignedIn(HOUR_AGO);

    const res = await post("/me/two-step/disable", { code: wrongCode(SECRET_BYTES, NOW) }, session);

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject(CODE_INVALID);
    expect((await twoStepRow(h, user.id))?.state).toBe("enabled");
    expect(await recoveryCodeRows(h, user.id)).toHaveLength(10);
  });

  it("TP-4.10: the right code (session confirmed an hour ago) → { ok: true }; the row and every recovery code removed; two_step_disabled with its email; sessions untouched", async () => {
    const { user, session } = await twoStepSignedIn(HOUR_AGO);
    const other = await sessionFactory(h, { userId: user.id, now: NOW });

    const res = await post("/me/two-step/disable", { code: codeAt(SECRET_BYTES, NOW) }, session);

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await twoStepRow(h, user.id)).toBeNull();
    expect(await recoveryCodeRows(h, user.id)).toEqual([]);
    await expectEventWithEmail(user.id, "two_step_disabled");
    expect((await sessionRow(session.sessionId))?.["revoked_at"]).toBeNull();
    expect((await sessionRow(other.sessionId))?.["revoked_at"]).toBeNull();
    expect(await meOf(session)).toMatchObject({
      twoStep: { enabled: false, recoveryCodesLeft: 0, codesAcknowledged: false },
    });
  });

  it("TP-4.10x: a recovery code also turns it off", async () => {
    const { user, codes, session } = await twoStepSignedIn(HOUR_AGO);

    const res = await post("/me/two-step/disable", { recoveryCode: codes[4] }, session);

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await twoStepRow(h, user.id)).toBeNull();
  });

  it("TP-4.10: on a user without two-step → 409 TWO_STEP_NOT_ENABLED", async () => {
    const { session } = await passwordUser(NOW);

    const res = await post("/me/two-step/disable", { code: "123456" }, session);

    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual(NOT_ENABLED);
  });
});

describe("TP-4.11: me.acknowledgeRecoveryCodes", () => {
  it("TP-4.11: enabled and not acknowledged (session confirmed an hour ago) → { ok: true }; me.get's codesAcknowledged true", async () => {
    const { session } = await twoStepSignedIn(HOUR_AGO, false);
    expect(await meOf(session)).toMatchObject({ twoStep: { codesAcknowledged: false } });

    const res = await post("/me/two-step/acknowledge-codes", {}, session);

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await meOf(session)).toMatchObject({
      twoStep: { enabled: true, codesAcknowledged: true },
    });
  });

  it("TP-4.11x: without two-step → 409 TWO_STEP_NOT_ENABLED", async () => {
    const { session } = await passwordUser(NOW);

    const res = await post("/me/two-step/acknowledge-codes", {}, session);

    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual(NOT_ENABLED);
  });
});

describe("TP-4.12: me.regenerateRecoveryCodes", () => {
  it("TP-4.12: after me.confirm with a recovery code, regenerate → 10 new codes; an old code fails and a new one works at me.confirm; codesAcknowledged false; recovery_codes_regenerated with its email", async () => {
    const { user, codes, session } = await twoStepSignedIn(HOUR_AGO, true);
    const confirmed = await post("/me/confirm", { recoveryCode: codes[0] }, session);
    expect(confirmed.status).toBe(200);

    const res = await post("/me/two-step/recovery-codes", {}, session);

    expect(res.status).toBe(200);
    const { recoveryCodes } = res.json() as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes) expect(code).toMatch(FORMAT);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(recoveryCodes.filter((c) => codes.includes(c))).toEqual([]);
    expect((await twoStepRow(h, user.id))?.codesAcknowledged).toBe(false);
    expect((await recoveryCodeRows(h, user.id)).filter((r) => !r.used)).toHaveLength(10);
    await expectEventWithEmail(user.id, "recovery_codes_regenerated");

    const old = await post("/me/confirm", { recoveryCode: codes[1] }, session);
    const fresh = await post("/me/confirm", { recoveryCode: recoveryCodes[0] }, session);

    expect(old.status).toBe(400);
    expect(errorOf(old)).toMatchObject(CODE_INVALID);
    expect(fresh.status).toBe(200);
  });

  it("TP-4.12x: without step-up → 403 CONFIRMATION_REQUIRED { factor: two_step }; the codes unchanged", async () => {
    const { user, session } = await twoStepSignedIn(HOUR_AGO);
    const before = await recoveryCodeRows(h, user.id);

    const res = await post("/me/two-step/recovery-codes", {}, session);

    expect(res.status).toBe(403);
    expect(errorOf(res)).toEqual(confirmationRequired("two_step"));
    expect(await recoveryCodeRows(h, user.id)).toEqual(before);
  });

  it("TP-4.12x: a confirmed user without two-step → 409 TWO_STEP_NOT_ENABLED", async () => {
    const { session } = await passwordUser(NOW);

    const res = await post("/me/two-step/recovery-codes", {}, session);

    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual(NOT_ENABLED);
  });
});

describe("TP-4.13: replacing the authenticator", () => {
  /** A two-step user (secret S1) whose session is confirmed now, after replace/start. */
  async function started() {
    const signedIn = await twoStepSignedIn(NOW);
    const res = await post("/me/two-step/replace/start", {}, signedIn.session);
    expect(res.status).toBe(200);
    const s2 = expectSetup(res.json() as SetupWire, signedIn.user.email, NOW.add({ minutes: 15 }));
    return { ...signedIn, s2 };
  }

  it("TP-4.13: start (with step-up) → a new secret S2, its URI and expiry now + 15 min; still enabled with S1; the pending envelope holds S2", async () => {
    const { user, s2 } = await started();

    const row = await twoStepRow(h, user.id);

    expect(row).toMatchObject({
      state: "enabled",
      pendingExpiresAt: NOW.add({ minutes: 15 }).epochMilliseconds,
    });
    expect(unseal(row?.secretEnvelope, user.id).equals(SECRET_BYTES)).toBe(true);
    expect(unseal(row?.pendingSecretEnvelope, user.id).equals(s2)).toBe(true);
  });

  it("TP-4.13: confirm with an S1 code → 400 TWO_STEP_CODE_INVALID; S1 stays, S2 still pending", async () => {
    const { user, session, s2 } = await started();

    const res = await post(
      "/me/two-step/replace/confirm",
      { code: codeAt(SECRET_BYTES, NOW) },
      session,
    );

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject(CODE_INVALID);
    const row = await twoStepRow(h, user.id);
    expect(unseal(row?.secretEnvelope, user.id).equals(SECRET_BYTES)).toBe(true);
    expect(unseal(row?.pendingSecretEnvelope, user.id).equals(s2)).toBe(true);
  });

  it("TP-4.13: confirm with an S2 code → { ok: true }; S2 is the secret; S1 codes then fail at sign-in and S2's sign in; recovery codes unchanged; authenticator_replaced with its email; no session revoked", async () => {
    const { user, session, s2 } = await started();
    const codesBefore = await recoveryCodeRows(h, user.id);

    const res = await post("/me/two-step/replace/confirm", { code: codeAt(s2, NOW) }, session);

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const row = await twoStepRow(h, user.id);
    expect(row).toMatchObject({
      state: "enabled",
      pendingSecretEnvelope: null,
      pendingExpiresAt: null,
      lastUsedStep: stepAt(NOW),
    });
    expect(unseal(row?.secretEnvelope, user.id).equals(s2)).toBe(true);
    expect(await recoveryCodeRows(h, user.id)).toEqual(codesBefore);
    await expectEventWithEmail(user.id, "authenticator_replaced");
    expect((await sessionRow(session.sessionId))?.["revoked_at"]).toBeNull();

    // Step s is used; s + 1 is free for both secrets.
    const withS1 = await verify(await signInChallenge(user.email), codeAt(SECRET_BYTES, NOW, 1));
    const withS2 = await verify(await signInChallenge(user.email), codeAt(s2, NOW, 1));

    expect(withS1.status).toBe(400);
    expect(errorOf(withS1)).toMatchObject(CODE_INVALID);
    expect(withS2.status).toBe(200);
    expect(withS2.json()).toMatchObject({ status: "signed_in" });
  });

  it("TP-4.13: then signing in with the S2 code that confirmed, in the same step → 400 TWO_STEP_CODE_INVALID { attemptsLeft: 4 } (replay); no new session", async () => {
    const { user, session, s2 } = await started();
    const confirmingCode = codeAt(s2, NOW);
    const confirmed = await post("/me/two-step/replace/confirm", { code: confirmingCode }, session);
    expect(confirmed.status).toBe(200);
    const sessionsBefore = await sessionCount(user.id);

    const res = await verify(await signInChallenge(user.email), confirmingCode);

    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({ ...CODE_INVALID, data: { attemptsLeft: 4 } });
    expect(await sessionCount(user.id)).toBe(sessionsBefore);
  });

  it("TP-4.13x: the pending code is checked with lastUsedStep null: after S1's step s is used at sign-in, S2's code for s − 1 confirms, and last_used_step becomes s − 1", async () => {
    const { user, session, s2 } = await started();
    const signedIn = await verify(await signInChallenge(user.email), codeAt(SECRET_BYTES, NOW));
    expect(signedIn.status).toBe(200);
    expect((await twoStepRow(h, user.id))?.lastUsedStep).toBe(stepAt(NOW));

    const res = await post("/me/two-step/replace/confirm", { code: codeAt(s2, NOW, -1) }, session);

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect((await twoStepRow(h, user.id))?.lastUsedStep).toBe(stepAt(NOW) - 1);
  });

  it("TP-4.13: confirm 15 min + 1 ms after start (S2's code for then) → 410 TWO_STEP_SETUP_EXPIRED; S1 stays; no limiter hit", async () => {
    const { user, session, s2 } = await started();
    api.clock.set(NOW.add({ minutes: 15, milliseconds: 1 }));
    const hitsBefore = await limiterHits(h);

    const res = await post(
      "/me/two-step/replace/confirm",
      { code: codeAt(s2, api.clock.now()) },
      session,
    );

    expect(res.status).toBe(410);
    expect(errorOf(res)).toEqual(SETUP_EXPIRED);
    expect(await limiterHits(h)).toEqual(hitsBefore);
    const row = await twoStepRow(h, user.id);
    expect(unseal(row?.secretEnvelope, user.id).equals(SECRET_BYTES)).toBe(true);
  });

  it("TP-4.13: confirm for a user without two-step → 409 TWO_STEP_NOT_ENABLED; the twostep.ip and TOTP limiter counts unchanged", async () => {
    const { session } = await passwordUser(HOUR_AGO);
    const hitsBefore = await limiterHits(h);

    const res = await post("/me/two-step/replace/confirm", { code: "123456" }, session);

    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual(NOT_ENABLED);
    expect(await limiterHits(h)).toEqual(hitsBefore);
  });

  it("TP-4.13x: confirm while two-step is only pending (setup started, not enabled) → 409 TWO_STEP_NOT_ENABLED; no limiter hit; still pending", async () => {
    const { user, session } = await passwordUser(HOUR_AGO);
    await pendingSecretFactory(h, apiSecretsOf(api), {
      userId: user.id,
      expiresAt: NOW.add({ minutes: 15 }),
    });
    const hitsBefore = await limiterHits(h);

    const res = await post(
      "/me/two-step/replace/confirm",
      { code: codeAt(SECRET_BYTES, NOW) },
      session,
    );

    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual(NOT_ENABLED);
    expect(await limiterHits(h)).toEqual(hitsBefore);
    expect((await twoStepRow(h, user.id))?.state).toBe("pending");
  });

  it("TP-4.13x: start without step-up → 403 CONFIRMATION_REQUIRED { factor: two_step }; nothing pending", async () => {
    const { user, session } = await twoStepSignedIn(HOUR_AGO);

    const res = await post("/me/two-step/replace/start", {}, session);

    expect(res.status).toBe(403);
    expect(errorOf(res)).toEqual(confirmationRequired("two_step"));
    expect((await twoStepRow(h, user.id))?.pendingSecretEnvelope).toBeNull();
  });

  it("TP-4.13x: start for a confirmed user without two-step → 409 TWO_STEP_NOT_ENABLED", async () => {
    const { session } = await passwordUser(NOW);

    const res = await post("/me/two-step/replace/start", {}, session);

    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual(NOT_ENABLED);
  });

  it("TP-4.13x: confirm with no replacement started → 410 TWO_STEP_SETUP_EXPIRED; no limiter hit", async () => {
    const { session } = await twoStepSignedIn(HOUR_AGO);
    const hitsBefore = await limiterHits(h);

    const res = await post(
      "/me/two-step/replace/confirm",
      { code: codeAt(SECRET_BYTES, NOW) },
      session,
    );

    expect(res.status).toBe(410);
    expect(errorOf(res)).toEqual(SETUP_EXPIRED);
    expect(await limiterHits(h)).toEqual(hitsBefore);
  });
});
