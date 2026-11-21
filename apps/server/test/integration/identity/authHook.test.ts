// F-24 createAuthHook (identity LLD §4.1). TP-0.12, plus extra cases TP-0.12x (boundaries, and both
// transports through P-F-55: S-0 acceptance criterion 3).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import type { AuthHook } from "../../../src/platform/http/context.js";
import { createApiServer } from "../../../src/platform/http/server.js";
import { generateToken } from "../../../src/identity/tokens.js";
import { sessionFactory, userFactory } from "../../factories/identity.js";
import { injectJson } from "../../support/api.js";
import { buildIdentityApi, T0, type IdentityApi } from "../../support/identity.js";
import { resetBetweenTests } from "../../support/testDatabase.js";
import { authContract, authRouter } from "../../support/testRouter.js";

let api: IdentityApi;
let hook: AuthHook;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const TAILNET = "x.ts.net";

beforeAll(async () => {
  api = await buildIdentityApi();
  hook = api.container.identity.authHook;
  h = api.testDb.database.handle;
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
  api.clock.set(T0);
});

const bearer = (token: string) => ({
  headers: { host: TAILNET, authorization: `Bearer ${token}` },
  cookies: {},
});
const cookie = (token: string, host = TAILNET, client = "web/1") => ({
  headers: { host, "x-budmon-client": client },
  cookies: { [host.startsWith("localhost") ? "budmon_at" : "__Secure-budmon_at"]: token },
});

async function activeUser(isProductOwner = false) {
  return userFactory(h, { isProductOwner });
}

async function pendingUser(by: "self" | "owner" | "ban") {
  return userFactory(h, {
    status: "pending_deletion",
    deletionRequestedAt: new Date(NOW.epochMilliseconds),
    deletionScheduledFor: new Date(NOW.add({ hours: 24 * 7 }).epochMilliseconds),
    deletionRequestedBy: by,
  });
}

describe("TP-0.12: the auth hook", () => {
  it("TP-0.12: a valid bearer session gives the principal with sessionId", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "bearer" });

    await expect(hook.authenticate(bearer(s.accessToken))).resolves.toEqual({
      userId: user.id,
      isOwner: false,
      sessionId: s.sessionId,
    });
  });

  it("TP-0.12: a valid cookie session with X-Budmon-Client web/1 gives the principal", async () => {
    const user = await activeUser(true);
    const s = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      delivery: "cookie",
      clientKind: "web",
    });

    await expect(hook.authenticate(cookie(s.accessToken))).resolves.toEqual({
      userId: user.id,
      isOwner: true,
      sessionId: s.sessionId,
    });
  });

  it("TP-0.12: a self-requested pending deletion still authenticates", async () => {
    const user = await pendingUser("self");
    const s = await sessionFactory(h, { userId: user.id, now: NOW });

    await expect(hook.authenticate(bearer(s.accessToken))).resolves.toMatchObject({
      userId: user.id,
    });
  });

  it.each(["owner", "ban"] as const)(
    "TP-0.12: a pending deletion requested by %s → null",
    async (by) => {
      const user = await pendingUser(by);
      const s = await sessionFactory(h, { userId: user.id, now: NOW });

      await expect(hook.authenticate(bearer(s.accessToken))).resolves.toBeNull();
    },
  );

  it("TP-0.12: an unknown well-formed token → null", async () => {
    await expect(hook.authenticate(bearer(generateToken("access")))).resolves.toBeNull();
  });

  it("TP-0.12: a cookie session's token sent as a bearer → null (delivery must match)", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "cookie" });

    await expect(hook.authenticate(bearer(s.accessToken))).resolves.toBeNull();
  });

  it("TP-0.12: a bearer session's token sent as a cookie → null", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "bearer" });

    await expect(hook.authenticate(cookie(s.accessToken))).resolves.toBeNull();
  });

  it("TP-0.12: a revoked session → null", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      revoked: { reason: "sign_out", at: NOW },
    });

    await expect(hook.authenticate(bearer(s.accessToken))).resolves.toBeNull();
  });

  it("TP-0.12: an expired access token (accessExpiresAt = now) → null", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, accessExpiresAt: NOW });

    await expect(hook.authenticate(bearer(s.accessToken))).resolves.toBeNull();
  });

  it("TP-0.12: an idle-expired session (idleExpiresAt = now) → null", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, idleExpiresAt: NOW });

    await expect(hook.authenticate(bearer(s.accessToken))).resolves.toBeNull();
  });

  it("TP-0.12: bearer and cookie together → the bearer is chosen", async () => {
    const user = await activeUser();
    const b = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "bearer" });
    const c = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "cookie" });
    const both = {
      headers: {
        host: TAILNET,
        authorization: `Bearer ${b.accessToken}`,
        "x-budmon-client": "web/1",
      },
      cookies: { "__Secure-budmon_at": c.accessToken },
    };

    await expect(hook.authenticate(both)).resolves.toMatchObject({ sessionId: b.sessionId });
  });

  it("TP-0.12: Authorization 'Bearer garbage' → null", async () => {
    await expect(hook.authenticate(bearer("garbage"))).resolves.toBeNull();
  });

  it("TP-0.12: a valid access cookie with X-Budmon-Client android/5 → null (CSRF)", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "cookie" });

    await expect(
      hook.authenticate(cookie(s.accessToken, TAILNET, "android/5")),
    ).resolves.toBeNull();
  });

  it("TP-0.12: an unprefixed access cookie with Host x.ts.net → null", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "cookie" });

    await expect(
      hook.authenticate({
        headers: { host: TAILNET, "x-budmon-client": "web/1" },
        cookies: { budmon_at: s.accessToken },
      }),
    ).resolves.toBeNull();
  });

  it("TP-0.12: a prefixed access cookie with Host localhost:8080 → null", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "cookie" });

    await expect(
      hook.authenticate({
        headers: { host: "localhost:8080", "x-budmon-client": "web/1" },
        cookies: { "__Secure-budmon_at": s.accessToken },
      }),
    ).resolves.toBeNull();
  });
});

describe("TP-0.12x: boundaries and the localhost names", () => {
  it("TP-0.12x: accessExpiresAt and idleExpiresAt 1 ms after now still authenticate", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      accessExpiresAt: NOW.add({ milliseconds: 1 }),
      idleExpiresAt: NOW.add({ milliseconds: 1 }),
    });

    await expect(hook.authenticate(bearer(s.accessToken))).resolves.toMatchObject({
      sessionId: s.sessionId,
    });
  });

  it("TP-0.12x: an unprefixed access cookie on localhost:8080 authenticates", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "cookie" });

    await expect(hook.authenticate(cookie(s.accessToken, "localhost:8080"))).resolves.toMatchObject(
      {
        sessionId: s.sessionId,
      },
    );
  });

  it("TP-0.12x: a cookie without any X-Budmon-Client header → null", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "cookie" });

    await expect(
      hook.authenticate({
        headers: { host: TAILNET },
        cookies: { "__Secure-budmon_at": s.accessToken },
      }),
    ).resolves.toBeNull();
  });

  it("TP-0.12x: a refresh token as the bearer → null", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW });

    await expect(hook.authenticate(bearer(s.refreshToken))).resolves.toBeNull();
  });

  it("TP-0.12x: no credentials → null; the hook writes nothing (last_used_at unchanged)", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW.subtract({ minutes: 5 }) });

    await expect(
      hook.authenticate({ headers: { host: TAILNET }, cookies: {} }),
    ).resolves.toBeNull();
    await hook.authenticate(bearer(s.accessToken));

    const { rows } = await h.executeSql("SELECT last_used_at FROM sessions WHERE id = $1", [
      s.sessionId,
    ]);
    expect((rows[0]?.["last_used_at"] as Date).getTime()).toBe(
      NOW.subtract({ minutes: 5 }).epochMilliseconds,
    );
  });
});

describe("TP-0.12x: both transports through the API server (P-F-55 with identity's hook)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApiServer(api.container, {
      contract: authContract,
      router: authRouter() as never,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("TP-0.12x: a bearer request reaches an authed procedure with the principal", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, { userId: user.id, now: NOW, delivery: "bearer" });

    const res = await injectJson(app, "GET", "/api/v1/test/authed-thing", undefined, {
      authorization: `Bearer ${s.accessToken}`,
    });

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ userId: user.id, isOwner: false, sessionId: s.sessionId });
  });

  it("TP-0.12x: a cookie request with the web client header reaches it too", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      delivery: "cookie",
      clientKind: "web",
    });

    const res = await injectJson(app, "GET", "/api/v1/test/authed-thing", undefined, {
      host: TAILNET,
      "x-budmon-client": "web/1",
      cookie: `__Secure-budmon_at=${s.accessToken}`,
    });

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ sessionId: s.sessionId });
  });

  it("TP-0.12x: the same cookie without the web client header is 401 UNAUTHENTICATED", async () => {
    const user = await activeUser();
    const s = await sessionFactory(h, {
      userId: user.id,
      now: NOW,
      delivery: "cookie",
      clientKind: "web",
    });

    const res = await injectJson(app, "GET", "/api/v1/test/authed-thing", undefined, {
      host: TAILNET,
      cookie: `__Secure-budmon_at=${s.accessToken}`,
    });

    expect(res.status).toBe(401);
    expect(res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
