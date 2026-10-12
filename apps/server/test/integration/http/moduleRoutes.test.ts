// F-55 step 4b, F-59 appRouter and F-96's module members (A-26). TP-4.22.
import { contract } from "@budmon/contract";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "../../../src/platform/http/appRouter.js";
import { noAuthHook } from "../../../src/platform/http/context.js";
import { createApiServer } from "../../../src/platform/http/server.js";
import { buildApiContainer, injectJson, observed } from "../../support/api.js";

const cleanups: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

describe("TP-4.22 (a): the default container and router", () => {
  it("TP-4.22 (a): createApiServer(c) without opts serves §5.2's body through appRouter", async () => {
    const built = await buildApiContainer();
    const app = await createApiServer(built.container);
    cleanups.push(
      () => built.close(),
      () => app.close(),
    );

    const res = await injectJson(app, "GET", "/api/v1/meta/client-config");

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({
      android: { minimumVersionCode: 0, latestVersionCode: 0, downloadUrl: null },
      web: { minimumBuild: 0 },
    });
  });

  it("TP-4.22 (a): the container's moduleRoutes is [] and its authHook is noAuthHook", async () => {
    const built = await buildApiContainer();
    cleanups.push(() => built.close());

    expect(built.container.moduleRoutes).toEqual([]);
    expect(built.container.authHook).toBe(noAuthHook);
  });

  it("TP-4.22 (a): appRouter's keys are the contract's keys", () => {
    expect(Object.keys(appRouter).sort()).toEqual(Object.keys(contract).sort());
  });
});

describe("TP-4.22 (b): a module route", () => {
  let app: FastifyInstance;
  const obs = observed();

  beforeAll(async () => {
    const built = await buildApiContainer({
      ...obs.overrides,
      moduleRoutes: [
        (a) => {
          a.get("/api/v1/test/module-route", () => Promise.resolve({ ok: true }));
        },
      ],
    });
    app = await createApiServer(built.container);
    cleanups.push(
      () => built.close(),
      () => app.close(),
    );
  });

  it("TP-4.22 (b): GET /api/v1/test/module-route is 200 {ok:true} with X-Request-Id, F-61's headers and one http_request line", async () => {
    const before = obs.capture.records().length;

    const res = await injectJson(app, "GET", "/api/v1/test/module-route");

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(String(res.headers["x-request-id"])).toMatch(/^[0-9a-f]{32}$/);
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const lines = obs.capture
      .records()
      .slice(before)
      .filter((l) => l["event"] === "http_request");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 200 });
  });

  it("TP-4.22 (b): GET /api/v1/test/other is the NOT_FOUND envelope", async () => {
    const res = await injectJson(app, "GET", "/api/v1/test/other");

    expect(res.status).toBe(404);
    expect(res.json()).toEqual({
      defined: true,
      code: "NOT_FOUND",
      status: 404,
      message: "Not found",
    });
  });
});

describe("TP-4.22 (c): a module route that registers GET /health/live again", () => {
  it("TP-4.22 (c): createApiServer rejects", async () => {
    const built = await buildApiContainer({
      moduleRoutes: [
        (a) => {
          a.get("/health/live", () => Promise.resolve({ status: "shadow" }));
        },
      ],
    });
    cleanups.push(() => built.close());

    await expect(createApiServer(built.container)).rejects.toThrow();
  });
});
