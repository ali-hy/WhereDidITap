// me.get (F-56; identity LLD §5.3) and default deny over the whole contract (TP-0.26).
// TP-3.23, TP-0.26, plus extra cases ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { contract, listProcedures } from "@budmon/contract";
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { PUBLIC_PROCEDURES } from "../../../src/platform/http/procedures.js";
import * as credentialsRepo from "../../../src/identity/credentialsRepo.js";
import {
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
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const wire = (i: Temporal.Instant): string => i.toString({ fractionalSecondDigits: 3 });
const wireDate = (d: Date): string => d.toISOString();

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

const me = (accessToken?: string) =>
  call(api.app, "GET", "/me", undefined, {
    headers: accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` },
  });

describe("TP-3.23: me.get", () => {
  it("TP-3.23: a user with a password, Google and two-step, signed in through a session confirmed at now: every Me field as stored", async () => {
    const user = await userFactory(h, {
      displayName: "Mona Hassan",
      locale: "en",
      timeZone: "Africa/Cairo",
      baseCurrency: "EGP",
    });
    await passwordFactory(h, user.id);
    await googleIdentityFactory(h, { userId: user.id, email: "mona.g@example.com", now: NOW });
    const apiSecrets = api.container.identity.deps.apiSecrets;
    if (apiSecrets === null) throw new Error("the API has no apiSecrets");
    await twoStepFactory(h, apiSecrets, {
      userId: user.id,
      now: NOW,
      recoveryCodes: 7,
      usedRecoveryCodes: 3,
      codesAcknowledged: true,
    });
    const session = await sessionFactory(h, { userId: user.id, now: NOW, confirmedAt: NOW });
    const password = await credentialsRepo.getPasswordHash(h, user.id);

    const res = await me(session.accessToken);

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      id: user.id,
      email: user.email,
      displayName: "Mona Hassan",
      locale: "en",
      timeZone: "Africa/Cairo",
      baseCurrency: "EGP",
      status: "active",
      deletionScheduledFor: null,
      isOwner: false,
      hasPassword: true,
      passwordUpdatedAt: wireDate(password?.updatedAt ?? new Date(0)),
      google: { email: "mona.g@example.com" },
      twoStep: { enabled: true, recoveryCodesLeft: 7, codesAcknowledged: true },
      confirmedUntil: wire(NOW.add({ minutes: 10 })),
      sessionId: session.sessionId,
    });
    for (const instant of [
      (res.json() as { confirmedUntil: string }).confirmedUntil,
      (res.json() as { passwordUpdatedAt: string }).passwordUpdatedAt,
    ]) {
      expect(instant).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it("TP-3.23x: a plain user (no password, Google or two-step), confirmed 11 minutes ago, owner, pending deletion", async () => {
    const scheduled = NOW.add({ hours: 24 * 7 });
    const user = await userFactory(h, {
      isProductOwner: true,
      status: "pending_deletion",
      deletionRequestedAt: new Date(NOW.epochMilliseconds),
      deletionScheduledFor: new Date(scheduled.epochMilliseconds),
      deletionRequestedBy: "self",
    });
    const session = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      confirmedAt: NOW.subtract({ minutes: 11 }),
    });

    const res = await me(session.accessToken);

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({
      status: "pending_deletion",
      deletionScheduledFor: wire(scheduled),
      isOwner: true,
      hasPassword: false,
      passwordUpdatedAt: null,
      google: null,
      twoStep: { enabled: false, recoveryCodesLeft: 0, codesAcknowledged: false },
      confirmedUntil: null,
    });
  });

  it("TP-3.23x: confirmed exactly 10 minutes ago: confirmedUntil is now, not in the future → null", async () => {
    const user = await userFactory(h);
    const session = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      confirmedAt: NOW.subtract({ minutes: 10 }),
    });

    expect((await me(session.accessToken)).json()).toMatchObject({ confirmedUntil: null });
  });

  it("TP-3.23x: without credentials → 401 UNAUTHENTICATED", async () => {
    const res = await me();

    expect(res.status).toBe(401);
    expect(errorOf(res).code).toBe("UNAUTHENTICATED");
  });
});

describe("TP-0.26: default deny over every procedure in the contract", () => {
  const procedures = listProcedures(contract);
  const UUID = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a99";

  it("TP-0.26: S-1's public identity procedures are in PUBLIC_PROCEDURES", () => {
    for (const path of ["auth.signUpOptions", "invitations.preview", "invitations.accept"]) {
      expect(PUBLIC_PROCEDURES.has(path), path).toBe(true);
    }
    expect(procedures.map((p) => p.path)).toEqual(expect.arrayContaining(["me.get"]));
  });

  it("TP-0.26: without credentials every non-public procedure answers 401 UNAUTHENTICATED, and no public one does", async () => {
    const outcomes: { path: string; public: boolean; unauthenticated: boolean }[] = [];
    for (const p of procedures) {
      const route = p.route.replace(/\{[^}]+\}/g, UUID);
      const res = await call(
        api.app,
        p.method === "GET" ? "GET" : "POST",
        route,
        p.method === "GET" ? undefined : {},
      );
      const body = res.json() as { code?: string };
      outcomes.push({
        path: p.path,
        public: PUBLIC_PROCEDURES.has(p.path),
        unauthenticated: res.status === 401 && body.code === "UNAUTHENTICATED",
      });
    }

    expect(outcomes.length).toBeGreaterThan(1);
    expect(outcomes.filter((o) => o.public === o.unauthenticated)).toEqual([]);
  });
});
