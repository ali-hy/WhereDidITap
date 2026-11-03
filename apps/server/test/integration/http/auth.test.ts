// F-53 procedure bases and F-54 auth hooks through HTTP. TP-4.8 (default deny) and TP-4.16, with a
// test contract built on procedureBases (A-123), plus extra cases TP-4.43x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { listProcedures } from "@budmon/contract";
import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import type { AuthHook } from "../../../src/platform/http/context.js";
import { PUBLIC_PROCEDURES } from "../../../src/platform/http/procedures.js";
import { createApiServer } from "../../../src/platform/http/server.js";
import { buildApiContainer, injectJson, testPrincipal } from "../../support/api.js";
import { authContract, authRouter } from "../../support/testRouter.js";

const cleanups: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function serve(authHook?: AuthHook): Promise<FastifyInstance> {
  const built = await buildApiContainer(authHook === undefined ? {} : { authHook });
  const app = await createApiServer(built.container, {
    contract: authContract,
    router: authRouter() as never,
  });
  cleanups.push(
    () => built.close(),
    () => app.close(),
  );
  return app;
}

const UNAUTHENTICATED = {
  defined: true,
  code: "UNAUTHENTICATED",
  status: 401,
  message: "Authentication required",
};

function hookReturning(principal: ReturnType<typeof testPrincipal>): AuthHook {
  return { authenticate: () => Promise.resolve(principal) };
}

describe("TP-4.8: default deny", () => {
  const procedures = listProcedures(authContract).filter((p) => !PUBLIC_PROCEDURES.has(p.path));

  it("TP-4.8: the test contract has non-public procedures to check", () => {
    expect(procedures.map((p) => p.path).sort()).toEqual(
      ["test.authedThing", "test.createThing", "test.ownerThing"].sort(),
    );
  });

  it.each(procedures.map((p) => [p.path, p] as const))(
    "TP-4.8: %s without credentials is 401 UNAUTHENTICATED",
    async (_path, p) => {
      const app = await serve();

      const res = await injectJson(
        app,
        p.method as "GET" | "POST",
        `/api/v1${p.route}`,
        p.method === "POST" ? { name: "x" } : undefined,
        p.method === "POST" ? { "idempotency-key": "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0e" } : {},
      );

      expect(res.status).toBe(401);
      expect(res.json()).toEqual(UNAUTHENTICATED);
    },
  );
});

describe("TP-4.16: procedure bases and auth hooks", () => {
  it("TP-4.16: an authed procedure echoes the principal unchanged, sessionId included", async () => {
    const principal = testPrincipal({ sessionId: "s-1" });
    const app = await serve(hookReturning(principal));

    const res = await injectJson(app, "GET", "/api/v1/test/authed-thing");

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      userId: principal.userId,
      isOwner: principal.isOwner,
      sessionId: "s-1",
    });
  });

  it("TP-4.16: a non-owner on an owner procedure is 403 FORBIDDEN", async () => {
    const app = await serve(hookReturning(testPrincipal({ isOwner: false })));

    const res = await injectJson(app, "GET", "/api/v1/test/owner-thing");

    expect(res.status).toBe(403);
    expect(res.json()).toEqual({
      defined: true,
      code: "FORBIDDEN",
      status: 403,
      message: "Forbidden",
    });
  });

  it("TP-4.16: an auth hook that throws gives 500 INTERNAL", async () => {
    const app = await serve({ authenticate: () => Promise.reject(new Error("hook failed")) });

    const res = await injectJson(app, "GET", "/api/v1/test/authed-thing");

    expect(res.status).toBe(500);
    expect(res.json()).toEqual({
      defined: true,
      code: "INTERNAL",
      status: 500,
      message: "Internal error",
      data: { outcome: "not_applied" },
    });
  });
});

describe("TP-4.43x: procedure bases, further cases (F-53)", () => {
  it("TP-4.43x: an owner on an owner procedure is 200 with the principal", async () => {
    const principal = testPrincipal({ isOwner: true });
    const app = await serve(hookReturning(principal));

    const res = await injectJson(app, "GET", "/api/v1/test/owner-thing");

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ...principal });
  });

  it("TP-4.43x: the public meta.clientConfig needs no credentials", async () => {
    const app = await serve();

    expect((await injectJson(app, "GET", "/api/v1/meta/client-config")).status).toBe(200);
  });

  it("TP-4.43x: PUBLIC_PROCEDURES holds meta.clientConfig", () => {
    expect([...PUBLIC_PROCEDURES]).toContain("meta.clientConfig");
  });
});
