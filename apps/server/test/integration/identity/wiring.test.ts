// Identity's container wiring (identity LLD F-34, §1.1, A-26 c). TP-0.32's container (U) and server
// (I) halves with S-0's expectations (S-3 adds the identity.purge handler), and TP-0.37 (the
// subscriber check), plus extra cases TP-0.32x.
// The static half of TP-0.32 is in test/unit/identity/wiring.test.ts.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AuthHook } from "../../../src/platform/http/context.js";
import { createApiServer } from "../../../src/platform/http/server.js";
import { buildHandlerMap } from "../../../src/platform/queue/handlers.js";
import { defineJob } from "../../../src/platform/queue/jobs.js";
import { createJobRegistry } from "../../../src/platform/queue/registry.js";
import type { ErasureHandler } from "../../../src/platform/container.js";
import { assertIdentitySubscribersRegistered } from "../../../src/identity/identityModule.js";
import { buildApiContainer, injectJson } from "../../support/api.js";
import { buildWorkerContainer } from "../../support/worker.js";

const cleanups: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function api(overrides: Parameters<typeof buildApiContainer>[0] = {}) {
  const built = await buildApiContainer(overrides);
  cleanups.push(() => built.close());
  return built.container;
}

async function worker(overrides: Parameters<typeof buildWorkerContainer>[1] = {}) {
  const built = await buildWorkerContainer("general", overrides);
  cleanups.push(() => built.close());
  return built.container;
}

describe("TP-0.32: the containers with identity (S-0)", () => {
  it("TP-0.32: the API container's authHook is identity's", async () => {
    const c = await api();

    expect(c.identity).toBeDefined();
    expect(c.authHook).toBe(c.identity.authHook);
  });

  it("TP-0.32: an authHook override wins", async () => {
    const hook: AuthHook = { authenticate: () => Promise.resolve(null) };

    const c = await api({ authHook: hook });

    expect(c.authHook).toBe(hook);
  });

  it("TP-0.32: moduleRoutes is [] by default, [r] with the override", async () => {
    const r = () => undefined;

    expect((await api()).moduleRoutes).toEqual([]);
    expect((await api({ moduleRoutes: [r] })).moduleRoutes).toEqual([r]);
  });

  it("TP-0.32: sealedColumns.all() is [] (TOTP columns arrive in S-4)", async () => {
    expect((await api()).sealedColumns.all()).toEqual([]);
  });

  it("TP-0.32: a general worker has identity, erasureHandler null and onGeneralStarted []", async () => {
    const c = await worker();

    expect(c.identity).toBeDefined();
    expect(c.erasureHandler).toBeNull();
    expect(c.onGeneralStarted).toEqual([]);
    expect(c.sealedColumns.all()).toEqual([]);
  });

  it("TP-0.32: an erasureHandler override wins", async () => {
    const handler: ErasureHandler = () => Promise.resolve();

    expect((await worker({ erasureHandler: handler })).erasureHandler).toBe(handler);
  });

  it("TP-0.32: buildHandlerMap(c) has a handler for every registered job, identity.email-send and (S-3) identity.purge included", async () => {
    const c = await worker();

    const keys = [...buildHandlerMap(c).keys()].sort();

    expect(keys).toContain("identity.email-send");
    expect(keys).toContain("identity.purge");
    expect(keys).toEqual(
      c.registry
        .all()
        .map((d) => d.name)
        .sort(),
    );
  });

  it("TP-0.32 (I): GET /api/v1/__test/emails is 404 outside the e2e stack", async () => {
    const c = await api();
    const app = await createApiServer(c);
    cleanups.push(() => app.close());

    const res = await injectJson(app, "GET", "/api/v1/__test/emails");

    expect(res.status).toBe(404);
  });
});

describe("TP-0.32x: identityOverrides reach the module", () => {
  it("TP-0.32x: identityOverrides.testRoutes adds a route the server serves", async () => {
    const c = await api({
      identityOverrides: {
        commonPasswords: new Set(),
        testRoutes: (app) => {
          app.get("/api/v1/__test/ping", () => Promise.resolve({ ok: true }));
        },
      },
    });
    const app = await createApiServer(c);
    cleanups.push(() => app.close());

    const res = await injectJson(app, "GET", "/api/v1/__test/ping");

    expect(c.moduleRoutes).toHaveLength(1);
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("TP-0.37: identity's event subscribers are checked against the registry", () => {
  const def = defineJob({
    name: "x.subscriber",
    role: "general",
    payload: z.object({ userId: z.string(), invitationId: z.string() }),
  });

  it("TP-0.37: (a) a registry holding the definition passes", async () => {
    const c = await api();
    c.identity.events.subscribe("identity.user-created", def);

    expect(() => {
      assertIdentitySubscribersRegistered({
        identity: c.identity,
        registry: createJobRegistry([def]),
      });
    }).not.toThrow();
  });

  it("TP-0.37: (b) the container's own registry, which lacks it → TypeError", async () => {
    const c = await api();
    c.identity.events.subscribe("identity.user-created", def);

    expect(() => {
      assertIdentitySubscribersRegistered({ identity: c.identity, registry: c.registry });
    }).toThrow(new TypeError("identity subscriber not registered: x.subscriber"));
  });

  it("TP-0.37: (c) a registry holding a different object with the same name → TypeError", async () => {
    const c = await api();
    c.identity.events.subscribe("identity.user-created", def);
    const lookalike = defineJob({ name: "x.subscriber", role: "general", payload: def.payload });

    expect(() => {
      assertIdentitySubscribersRegistered({
        identity: c.identity,
        registry: createJobRegistry([lookalike]),
      });
    }).toThrow(new TypeError("identity subscriber not registered: x.subscriber"));
  });
});
