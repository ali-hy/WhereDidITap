// TP-0.33x: several Set-Cookie values appended to ctx.resHeaders reach the reply as separate
// headers through oRPC's ResponseHeadersPlugin (F-55), independent of identity's F-27. It runs on
// the platform as built and decides §1.1's pre-written contingency. TP-0.33 (deliverSession) is in
// deliverSessionThroughOrpc.test.ts.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { base, contract } from "@budmon/contract";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { metaRouter } from "../../../src/platform/http/meta.js";
import { procedureBases } from "../../../src/platform/http/procedures.js";
import { createApiServer } from "../../../src/platform/http/server.js";
import { buildApiContainer, injectJson } from "../../support/api.js";

const COOKIES = [
  "__Secure-budmon_at=a1; Path=/api/v1; Max-Age=900; HttpOnly; Secure; SameSite=Strict",
  "__Secure-budmon_rt=r1; Path=/api/v1/auth/refresh; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict",
  "__Secure-budmon_dv=d1; Path=/api/v1; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict",
  "__Secure-budmon_2fa=; Path=/api/v1/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
];

const cookieContract = {
  ...contract,
  test: {
    cookies: base
      .route({ method: "POST", path: "/test/cookies" })
      .input(z.object({}))
      .output(z.object({ ok: z.boolean() })),
  },
};

const cleanups: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

describe("TP-0.33x: Set-Cookie values through oRPC", () => {
  it("TP-0.33x: four values appended to ctx.resHeaders arrive as four separate set-cookie headers", async () => {
    const { publicProcedure } = procedureBases(cookieContract);
    const router = {
      meta: metaRouter,
      test: {
        cookies: publicProcedure.test.cookies.handler(({ context }) => {
          for (const value of COOKIES) context.resHeaders.append("set-cookie", value);
          return { ok: true };
        }),
      },
    };
    const built = await buildApiContainer();
    const app = await createApiServer(built.container, {
      contract: cookieContract,
      router: router as never,
    });
    cleanups.push(
      () => built.close(),
      () => app.close(),
    );

    const res = await injectJson(
      app,
      "POST",
      "/api/v1/test/cookies",
      {},
      {
        host: "x.ts.net",
        "x-budmon-client": "web/1",
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toEqual(COOKIES);
  });
});
