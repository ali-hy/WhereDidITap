// Step-up: me.confirm with a password (F-55) through the real HTTP layer, and F-28's helpers
// (requireConfirmedTx, requireConfirmed, confirmationFactor) against a real database (identity LLD
// §4.1, §4.4, §5.3, §6). TP-3.21, TP-3.22, TP-3.29, plus extra cases ending in "x".
// TP-3.22 and TP-3.29 are typed U in the LLD; F-28 reads the session and credentials through the
// repos on a DbHandle (nothing injectable), so they run here on a real database.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import type { Principal, RequestContext } from "../../../src/platform/http/context.js";
import { ConfirmationRequiredError } from "../../../src/identity/identityErrors.js";
import type { IdentityDeps } from "../../../src/identity/identityModule.js";
import {
  confirmationFactor,
  requireConfirmed,
  requireConfirmedTx,
} from "../../../src/identity/requireConfirmed.js";
import {
  FACTORY_PASSWORD,
  googleIdentityFactory,
  passwordFactory,
  sessionFactory,
  twoStepFactory,
  userFactory,
} from "../../factories/identity.js";
import { buildIdentityApi, T0, type IdentityApi } from "../../support/identity.js";
import { call, errorOf } from "../../support/identityHttp.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let deps: IdentityDeps;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const wire = (i: Temporal.Instant): string => i.toString({ fractionalSecondDigits: 3 });
const ms = (d: unknown): number | null => (d === null ? null : (d as Date).getTime());

beforeAll(async () => {
  api = await buildIdentityApi();
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

type Kind = "password" | "two_step" | "google";

/** A user of the given kind: a password; two-step (with a password too); Google only. */
async function userOf(kind: Kind) {
  const user = await userFactory(h);
  if (kind !== "google") await passwordFactory(h, user.id);
  if (kind === "two_step") {
    const apiSecrets = deps.apiSecrets;
    if (apiSecrets === null) throw new Error("the API has no apiSecrets");
    await twoStepFactory(h, apiSecrets, { userId: user.id, now: NOW });
  }
  if (kind === "google") {
    await googleIdentityFactory(h, { userId: user.id, email: user.email, now: NOW });
  }
  return user;
}

async function signedIn(kind: Kind, confirmedAt: Temporal.Instant) {
  const user = await userOf(kind);
  const session = await sessionFactory(h, { userId: user.id, now: NOW, confirmedAt });
  const principal: Principal = { userId: user.id, isOwner: false, sessionId: session.sessionId };
  return { user, session, principal };
}

const confirm = (accessToken: string, body: Record<string, unknown>, ip?: string) =>
  call(api.app, "POST", "/me/confirm", body, {
    headers: { authorization: `Bearer ${accessToken}` },
    ...(ip === undefined ? {} : { ip }),
  });

const confirmedAt = async (sessionId: string): Promise<number | null> =>
  ms(
    (await h.executeSql("SELECT confirmed_at FROM sessions WHERE id = $1", [sessionId])).rows[0]?.[
      "confirmed_at"
    ],
  );

const FACTOR_NOT_ACCEPTED = {
  code: "VALIDATION_FAILED",
  status: 400,
  data: {
    issues: [{ path: ["password"], code: "factor_not_accepted", message: "Factor not accepted" }],
  },
};

describe("TP-3.21: me.confirm with a password", () => {
  it("TP-3.21: the right password → { confirmedUntil: now + 10 min }; the session's confirmed_at is now", async () => {
    const { session } = await signedIn("password", NOW.subtract({ hours: 1 }));

    const res = await confirm(session.accessToken, { password: FACTORY_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ confirmedUntil: wire(NOW.add({ minutes: 10 })) });
    expect(await confirmedAt(session.sessionId)).toBe(NOW.epochMilliseconds);
  });

  it("TP-3.21: a wrong password → 401 INVALID_CREDENTIALS; confirmed_at unchanged", async () => {
    const before = NOW.subtract({ hours: 1 });
    const { session } = await signedIn("password", before);

    const res = await confirm(session.accessToken, { password: "not the right password" });

    expect(res.status).toBe(401);
    expect(errorOf(res)).toEqual({
      defined: true,
      code: "INVALID_CREDENTIALS",
      status: 401,
      message: "Invalid credentials",
    });
    expect(await confirmedAt(session.sessionId)).toBe(before.epochMilliseconds);
  });

  it("TP-3.21: a two-step user (who also has a password) sending a password → 400 VALIDATION_FAILED factor_not_accepted (path password)", async () => {
    const before = NOW.subtract({ hours: 1 });
    const { session } = await signedIn("two_step", before);

    const res = await confirm(session.accessToken, { password: FACTORY_PASSWORD });

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject(FACTOR_NOT_ACCEPTED);
    expect(await confirmedAt(session.sessionId)).toBe(before.epochMilliseconds);
  });

  it("TP-3.21: a Google-only user sending a password field → 400 VALIDATION_FAILED factor_not_accepted (path password)", async () => {
    const before = NOW.subtract({ hours: 1 });
    const { session } = await signedIn("google", before);

    const res = await confirm(session.accessToken, { password: FACTORY_PASSWORD });

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject(FACTOR_NOT_ACCEPTED);
    expect(await confirmedAt(session.sessionId)).toBe(before.epochMilliseconds);
  });

  it("TP-3.21: 11 wrong passwords within 15 minutes (from different IPs) → the 11th is RATE_LIMITED (confirm.user)", async () => {
    const { session } = await signedIn("password", NOW.subtract({ hours: 1 }));
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      api.clock.set(NOW.add({ minutes: i }).toString());
      statuses.push((await confirm(session.accessToken, { password: "wrong password!" })).status);
    }
    api.clock.set(NOW.add({ minutes: 14 }).toString());

    const last = await confirm(session.accessToken, { password: "wrong password!" });

    expect(statuses).toEqual(Array.from({ length: 10 }, () => 401));
    expect(last.status).toBe(429);
    expect(errorOf(last).code).toBe("RATE_LIMITED");
    expect(last.headers["retry-after"]).toBeDefined();
  }, 60_000);

  it("TP-3.21x (A-73): a password user sending {} → 400 VALIDATION_FAILED required (path password); confirmed_at unchanged", async () => {
    const before = NOW.subtract({ hours: 1 });
    const { session } = await signedIn("password", before);

    const res = await confirm(session.accessToken, {});

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      data: { issues: [{ path: ["password"], code: "required", message: "Required" }] },
    });
    expect(await confirmedAt(session.sessionId)).toBe(before.epochMilliseconds);
  });

  it("TP-3.21x (A-73): a two-step user sending {} → 400 VALIDATION_FAILED required (path code)", async () => {
    const { session } = await signedIn("two_step", NOW.subtract({ hours: 1 }));

    const res = await confirm(session.accessToken, {});

    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      data: { issues: [{ path: ["code"], code: "required", message: "Required" }] },
    });
  });

  it("TP-3.21x (A-73): {} is refused before the limiter: 9 wrong passwords, then {} → 400 required, then a 10th wrong one → 401 INVALID_CREDENTIALS (not RATE_LIMITED)", async () => {
    const { session } = await signedIn("password", NOW.subtract({ hours: 1 }));
    for (let i = 0; i < 9; i += 1) {
      await confirm(session.accessToken, { password: "wrong password!" });
    }

    const empty = await confirm(session.accessToken, {});
    const tenth = await confirm(session.accessToken, { password: "wrong password!" });

    expect(empty.status).toBe(400);
    expect(errorOf(empty).code).toBe("VALIDATION_FAILED");
    expect(tenth.status).toBe(401);
    expect(errorOf(tenth).code).toBe("INVALID_CREDENTIALS");
  }, 60_000);

  it("TP-3.21x: without credentials → 401 UNAUTHENTICATED", async () => {
    const res = await call(api.app, "POST", "/me/confirm", { password: FACTORY_PASSWORD });

    expect(res.status).toBe(401);
    expect(errorOf(res).code).toBe("UNAUTHENTICATED");
  });

  it("TP-3.21x: confirming lets me.get report the new confirmedUntil", async () => {
    const { session } = await signedIn("password", NOW.subtract({ hours: 1 }));
    await confirm(session.accessToken, { password: FACTORY_PASSWORD });

    const me = await call(api.app, "GET", "/me", undefined, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    expect(me.json()).toMatchObject({ confirmedUntil: wire(NOW.add({ minutes: 10 })) });
  });
});

describe("TP-3.22: requireConfirmedTx and confirmationFactor (F-28)", () => {
  it.each(["password", "two_step", "google"] as const)(
    "TP-3.22: %s user confirmed exactly 10 minutes ago → passes",
    async (kind) => {
      const { principal } = await signedIn(kind, NOW.subtract({ minutes: 10 }));

      await expect(requireConfirmedTx(deps, h, principal)).resolves.toBeUndefined();
    },
  );

  it.each(["password", "two_step", "google"] as const)(
    "TP-3.22: %s user confirmed 10 minutes and 1 ms ago → CONFIRMATION_REQUIRED { factor: %s }",
    async (kind) => {
      const { principal } = await signedIn(kind, NOW.subtract({ minutes: 10, milliseconds: 1 }));

      const err: unknown = await requireConfirmedTx(deps, h, principal).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConfirmationRequiredError);
      expect(err).toMatchObject({
        key: "CONFIRMATION_REQUIRED",
        status: 403,
        message: "Confirmation required",
        details: { factor: kind },
      });
    },
  );

  it.each(["password", "two_step", "google"] as const)(
    "TP-3.22: confirmationFactor for a %s user → %s",
    async (kind) => {
      const user = await userOf(kind);

      expect(await confirmationFactor(deps, h, user.id)).toBe(kind);
    },
  );

  it("TP-3.22x: a principal whose session doesn't exist → UNAUTHENTICATED", async () => {
    const user = await userOf("password");
    const principal: Principal = {
      userId: user.id,
      isOwner: false,
      sessionId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a78",
    };

    await expect(requireConfirmedTx(deps, h, principal)).rejects.toMatchObject({
      key: "UNAUTHENTICATED",
      status: 401,
    });
  });

  it("TP-3.22x: maxAgeSeconds 300 with a session confirmed exactly 5 minutes ago → passes (the limit is inclusive)", async () => {
    const { principal } = await signedIn("password", NOW.subtract({ minutes: 5 }));

    await expect(requireConfirmedTx(deps, h, principal, 300)).resolves.toBeUndefined();
  });
});

describe("TP-3.29: requireConfirmed(ctx, maxAgeSeconds) for other modules", () => {
  const ctxFor = (principal: Principal) =>
    ({ container: api.container, principal }) as unknown as RequestContext & {
      principal: Principal;
    };

  it("TP-3.29: confirmed 5 minutes ago with maxAgeSeconds 600 → passes", async () => {
    const { principal } = await signedIn("password", NOW.subtract({ minutes: 5 }));

    await expect(requireConfirmed(ctxFor(principal), 600)).resolves.toBeUndefined();
  });

  it("TP-3.29: confirmed 5 minutes ago with maxAgeSeconds 240 → CONFIRMATION_REQUIRED { factor: password }", async () => {
    const { principal } = await signedIn("password", NOW.subtract({ minutes: 5 }));

    const err: unknown = await requireConfirmed(ctxFor(principal), 240).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConfirmationRequiredError);
    expect(err).toMatchObject({ details: { factor: "password" } });
  });

  it.each([0, 601])("TP-3.29: maxAgeSeconds %d → RangeError", async (maxAgeSeconds) => {
    const { principal } = await signedIn("password", NOW.subtract({ minutes: 5 }));

    await expect(requireConfirmed(ctxFor(principal), maxAgeSeconds)).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  it.each([1.5, -1])(
    "TP-3.29x: maxAgeSeconds %d (not an integer 1..600) → RangeError",
    async (v) => {
      const { principal } = await signedIn("password", NOW.subtract({ minutes: 5 }));

      await expect(requireConfirmed(ctxFor(principal), v)).rejects.toBeInstanceOf(RangeError);
    },
  );

  it("TP-3.29x: without maxAgeSeconds the default is 600 (confirmed 10 minutes ago passes, 10 minutes and 1 ms doesn't)", async () => {
    const fresh = await signedIn("password", NOW.subtract({ minutes: 10 }));
    const stale = await signedIn("password", NOW.subtract({ minutes: 10, milliseconds: 1 }));

    await expect(requireConfirmed(ctxFor(fresh.principal))).resolves.toBeUndefined();
    await expect(requireConfirmed(ctxFor(stale.principal))).rejects.toBeInstanceOf(
      ConfirmationRequiredError,
    );
  });

  it("TP-3.29x: maxAgeSeconds 1 with a session confirmed exactly 1 s ago → passes", async () => {
    const { principal } = await signedIn("password", NOW.subtract({ seconds: 1 }));

    await expect(requireConfirmed(ctxFor(principal), 1)).resolves.toBeUndefined();
  });
});
